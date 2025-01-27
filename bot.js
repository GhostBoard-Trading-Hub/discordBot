const { Client, GatewayIntentBits, Events } = require('discord.js');
const { Client: PGClient } = require('pg');
require('dotenv').config();

// PostgreSQL client setup
const pgClient = new PGClient({
    connectionString: process.env.DATABASE_URL,
});

// Connect to the PostgreSQL database
pgClient.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Database connection error', err));

// Discord client setup
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Replace this with your actual role ID
const PREMIUM_ROLE_ID = '1332816956692365482';

discordClient.once('ready', async () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);

    // Check if the bot has permission to manage roles in each guild
    const guilds = discordClient.guilds.cache;
    for (const [guildId, guild] of guilds) {
        const botMember = await guild.members.fetch(discordClient.user.id);
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            console.warn(`Missing permission to manage roles in guild: ${guild.name}`);
        } else {
            console.log(`Bot has permission to manage roles in guild: ${guild.name}`);
        }
    }
});

discordClient.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options, user } = interaction;

    if (commandName === 'link') {
        const uniqueCode = options.getString('unique_code');

        try {
            const result = await pgClient.query('SELECT * FROM users WHERE discord_code = $1', [uniqueCode]);
            const userData = result.rows[0];

            if (!userData) {
                await interaction.reply({ content: 'No account found with that unique code.', ephemeral: true });
                return;
            }

            if (userData.discord_id) {
                await interaction.reply({ content: 'This account is already linked.', ephemeral: true });
                return;
            }

            if (!userData.status) {
                await interaction.reply({ content: 'This account is banned/inactive. Please contact support.', ephemeral: true });
                return;
            }

            // Update the discord_id for the user
            await pgClient.query('UPDATE users SET discord_id = $1 WHERE discord_code = $2', [user.id, uniqueCode]);

            const guild = interaction.guild;
            const member = await guild.members.fetch(user.id);
            const premiumRole = guild.roles.cache.get(PREMIUM_ROLE_ID);

            if (!premiumRole) {
                await interaction.reply({ content: 'Premium role does not exist.', ephemeral: true });
                return;
            }

            if (userData.premium) {
                // Add premium role if the user has premium status
                await member.roles.add(premiumRole);
                await interaction.reply({ content: 'Your account has been linked and the premium role has been granted.', ephemeral: true });
            } else {
                // Remove premium role if the user does not have premium status
                if (member.roles.cache.has(premiumRole.id)) {
                    await member.roles.remove(premiumRole);
                }
                await interaction.reply({ content: 'Your account has been linked, but you do not have premium status.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await interaction.reply({ content: 'An error occurred while processing your request. Please try again later.', ephemeral: true });
        }
    }
});

// Log in to Discord with your bot token
discordClient.login(process.env.DISCORD_TOKEN);