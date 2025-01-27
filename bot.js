const { Client, GatewayIntentBits, Events, PermissionsBitField } = require('discord.js');
const { Client: PGClient } = require('pg');
const Stripe = require('stripe');
require('dotenv').config();

// PostgreSQL client setup
const pgClient = new PGClient({
    connectionString: process.env.DATABASE_URL,
});

// Stripe client setup
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Discord client setup
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Premium role ID
const PREMIUM_ROLE_ID = '998608314583756801';
const allowedGuilds = ['790412544132907019'];

// Connect to PostgreSQL
pgClient.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Database connection error:', err));

discordClient.on('ready', async () => {

    const unauthorizedGuilds = discordClient.guilds.cache.filter(guild => !allowedGuilds.includes(guild.id));

    for (const guild of unauthorizedGuilds.values()) {
        console.log(`Unauthorized server detected: ${guild.name}. Leaving server...`);
        await guild.leave(); // Leave the unauthorized server.
    }

    console.log('Bot is ready and checked for unauthorized guilds.');
});

discordClient.on('guildCreate', async (guild) => {
    if (!allowedGuilds.includes(guild.id)) {
        console.log(`Unauthorized server detected: ${guild.name}. Leaving server...`);
        await guild.leave();
    } else {
        console.log(`Bot added to an authorized server: ${guild.name}`);
    }
});
    
// Helper function to check subscriptions
async function checkSubscriptions() {
    try {
        const result = await pgClient.query('SELECT discord_id, email, premium FROM users WHERE discord_id IS NOT NULL');
        const users = result.rows;

        console.log(`Checking subscriptions for ${users.length} users...`);

        for (const user of users) {
            const { discord_id, email, premium } = user;

            const customers = await stripe.customers.list({ email });
            
            const activeSubscriptions = await Promise.all(customers.data.map(async (customer) => {
                const subscriptions = await stripe.subscriptions.list({ customer: customer.id });
                // subscriptions.data.forEach(sub => {
                //     console.log(`Customer ID: ${customer.id}, Subscription ID: ${sub.id}, Status: ${sub.status}`);
                // });
                // console.log(subscriptions)
                return subscriptions.data.filter(sub => sub.status === 'active');
            }));

            const flattenedActiveSubscriptions = activeSubscriptions.flat();

            const hasActiveSubscription = flattenedActiveSubscriptions.length > 0;

            const guild = discordClient.guilds.cache.first();
            if (!guild) continue;

            const member = await guild.members.fetch(discord_id).catch(() => null);
            if (!member) continue;

            const premiumRole = guild.roles.cache.get(PREMIUM_ROLE_ID);
            if (!premiumRole) {
                console.warn('Premium role not found in the guild.');
                continue;
            }

            if (hasActiveSubscription) {
                if (!member.roles.cache.has(premiumRole.id)) {
                    await member.roles.add(premiumRole);
                    console.log(`Added premium role to ${email}`);
                }
            } else if (!hasActiveSubscription) {
                if (member.roles.cache.has(premiumRole.id)) {
                    await member.roles.remove(premiumRole);
                    console.log(`Removed premium role from ${email}`);
                }
            }
        }
        console.log(`Check Done`);
    } catch (error) {
        console.error('Error checking subscriptions:', error);
    }
}

discordClient.once('ready', async () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);

    const guilds = discordClient.guilds.cache;
    for (const [guildId, guild] of guilds) {
        const botMember = await guild.members.fetch(discordClient.user.id);
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            console.warn(`Missing permission to manage roles in guild: ${guild.name}`);
        } else {
            console.log(`Bot has permission to manage roles in guild: ${guild.name}`);
        }
    }

    // Run subscription check on startup
    await checkSubscriptions();

    // Schedule subscription checks every 15 minutes
    setInterval(checkSubscriptions, 15 * 60 * 1000);
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

            await pgClient.query('UPDATE users SET discord_id = $1 WHERE discord_code = $2', [user.id, uniqueCode]);

            const guild = interaction.guild;
            const member = await guild.members.fetch(user.id);
            const premiumRole = guild.roles.cache.get(PREMIUM_ROLE_ID);

            if (!premiumRole) {
                await interaction.reply({ content: 'Premium role does not exist.', ephemeral: true });
                return;
            }

            if (userData.premium) {
                await member.roles.add(premiumRole);
                await interaction.reply({ content: 'Your account has been linked and the premium role has been granted.', ephemeral: true });
            } else {
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

// Log in to Discord
discordClient.login(process.env.DISCORD_TOKEN);
