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
        GatewayIntentBits.MessageContent, // Make sure this is included
        GatewayIntentBits.GuildMembers,    // Required for managing roles
    ],
});

// Replace this with your actual role ID
const PREMIUM_ROLE_ID = '998608314583756801';

discordClient.once('ready', async () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);

    // Check if the bot has permission to manage roles in each guild
    const guilds = discordClient.guilds.cache;
    for (const [guildId, guild] of guilds) {
        const botMember = await guild.members.fetch(discordClient.user.id);
        if (!botMember.permissions.has('MANAGE_ROLES')) {
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
                await interaction.reply('No account found with that unique code.');
                return;
            }

            if (userData.discord_id) {
                await interaction.reply('This account is already linked.');
                return;
            }

            if (!userData.status) {
                await interaction.reply('This account is banned/inactive. Please contact support.');
                return;
            }

            // Update the discord_id for the user
            await pgClient.query('UPDATE users SET discord_id = $1 WHERE discord_code = $2', [user.id, uniqueCode]);

            const guild = interaction.guild;
            const member = await guild.members.fetch(user.id);
            const premiumRole = guild.roles.cache.get(PREMIUM_ROLE_ID);

            if (!premiumRole) {
                await interaction.reply('Premium role does not exist.');
                return;
            }

            if (userData.premium) {
                // Add premium role if the user has premium status
                await member.roles.add(premiumRole);
                await interaction.reply('Your account has been linked and the premium role has been granted.');
            } else {
                // Remove premium role if the user does not have premium status
                if (member.roles.cache.has(premiumRole.id)) {
                    await member.roles.remove(premiumRole);
                }
                await interaction.reply('Your account has been linked, but you do not have premium status.');
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await interaction.reply('An error occurred while processing your request. Please try again later.');
        }
    }
});

// Log in to Discord with your bot token
discordClient.login(process.env.DISCORD_TOKEN);