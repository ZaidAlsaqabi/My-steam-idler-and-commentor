const SteamCommunity = require('steamcommunity');
const ReadLine = require('readline');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require("node-fetch");
const SteamUser = require('steam-user');
var fs = require('fs');
var util = require('util');
const ConfigEncryption = require('./util/encrypt.js');
const createSteamAuth = require('./util/steamAuth.js');

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const colorEnabled = process.stdout.isTTY !== false;
function paint(code, text) {
    if (!colorEnabled || text == null) return String(text);
    return '\x1b[' + code + 'm' + text + '\x1b[0m';
}
const clr = {
    bold: (t) => paint('1', t),
    dim: (t) => paint('2', t),
    red: (t) => paint('31', t),
    green: (t) => paint('32', t),
    yellow: (t) => paint('33', t),
    blue: (t) => paint('34', t),
    magenta: (t) => paint('35', t),
    purple: (t) => paint('38;5;141', t),
    cyan: (t) => paint('36', t)
};

const CONFIG_PATH = './config/config.json';

try {
    config = require('./config/config.json');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('The config file does not exist. Please ensure you have a config/config.json file.');
        process.exit(1); // Exit with a failure code
    }
    throw error; // Re-throw the error if it's not a "module not found" error
}

const encryption = new ConfigEncryption(process.env.CONFIG_MASTER_KEY);
if (encryption.encryptConfigAtRuntime(CONFIG_PATH, config) === 'encrypted') {
    console.log('Encrypted login credentials in config.json.');
}
encryption.unlockSecrets(config);
if (!config.online_status) {
    config.online_status = 'Online';
}
const steamAuth = createSteamAuth(encryption);
steamAuth.ensureTokenEncrypted();

// ------------------------------ MAIN ------------------------------ //

fs.readFile('./media/logo.txt', 'utf8', (err, data) => {
	if (err) {
	  console.error(err);
	  return;
	}
	console.log(clr.purple(data));

// SETUP FILE & STDOUT LOGGING
var logFile = fs.createWriteStream('log.txt', { flags: 'a' });
// Or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;
console.log = function () {
	const formatted = util.format.apply(null, arguments);
	logFile.write('> ' + new Date().toISOString() + ': ' + formatted.replace(ANSI_RE, '') + '\n');
	logStdout.write(formatted + '\n');
}

const tgBot = config.tg_bot_token ? new TelegramBot(config.tg_bot_token) : null;

// PROCESS CONFIG:
// - Check for required config values
if (!config.username || !config.password || !config.groups || config.groups.length == 0) {
	console.log("Invalid config! Please run the `configure-bot` command?");
	process.exit(1);
}
// - Check for optional config values
if (!config.message) {
	// Read message from ./config/message.txt
	try {
		config.message = fs.readFileSync('./config/message.txt', 'utf8');
	} catch (err) {
		console.log("No message was set in the config, and could not read message from ./config/message.txt");
		process.exit(1);
	}
}

var rl = ReadLine.createInterface({
	"input": process.stdin,
	"output": process.stdout
});

// Add keyboard listener for menu return
const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}

let isEnteringSteamGuard = false;

process.stdin.on('keypress', (str, key) => {
    if (!key || isEnteringSteamGuard) return;
    const name = key.name;

    if (name === 'm') {
        if (isMenuActive) return;
        stopAllExceptIdle();
        if (isIdling) {
            console.log(clr.cyan("Returning to menu. Idling keeps running. Press S to stop idling."));
        } else {
            console.log(clr.cyan("\nReturning to menu..."));
        }
        showMenu();
        return;
    }

    if (name === 's') {
        if (isMenuActive) return;
        stopIdling(true);
        return;
    }

    if (name === 'escape') {
        console.log(clr.red("\nExiting..."));
        process.exit(0);
    }
});

// Add global variables for idling tracking
let steamUserInstance = null;
let communityInstance = null;
let isIdling = false;
let idleStartTime = null;
let idleTimer = null;
let idleRetryTimer = null;
let idleLogonAttempts = 0;
let steamConnecting = false;
let desiredSession = { idle: false, community: false };
let gameNames = new Map();
let statusLines = [];
const MAX_STATUS_LINES = 5;
let isMenuActive = false; // Add flag to track menu state
let friendCommentTimer = null;
let friendCommentPendingTimeouts = [];
let friendNameCache = new Map();
let groupCommentTimer = null;
let groupCommentWarmupTimer = null;
let groupCycleRunning = false;
let groupCommenterStopRequested = false;
let groupPostPausedUntil = 0;
let lastGroupRateLimitAt = 0;
const GROUP_CACHE_PATH = './config/group-cache.json';
const groupNameCache = new Map();
let groupIdCache = {};
try {
    groupIdCache = JSON.parse(fs.readFileSync(GROUP_CACHE_PATH, 'utf8')) || {};
} catch (_) {
    groupIdCache = {};
}

// Add function to get game names from Steam API
async function getGameNames(appIds) {
    try {
        console.log(`\nFetching names for ${appIds.length} game(s)...`);
        // Make individual requests for each game to avoid rate limiting
        for (const appId of appIds) {
            try {
                const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
                const data = await response.json();
                
                if (data && data[appId] && data[appId].success && data[appId].data && data[appId].data.name) {
                    gameNames.set(appId, data[appId].data.name);
                    console.log(`Successfully fetched name for game ${appId}: ${data[appId].data.name}`);
                } else {
                    console.log(`Could not fetch name for game ${appId}, using default name`);
                    gameNames.set(appId, `Game (${appId})`);
                }
                
                // Add a small delay between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.log(`Error processing game ${appId}:`, err.message);
                gameNames.set(appId, `Game (${appId})`);
            }
        }
        console.log(`\nCompleted fetching names for ${appIds.length} game(s)`);
    } catch (error) {
        console.log("Error in getGameNames:", error.message);
        // Set default names if API fails
        for (const appId of appIds) {
            gameNames.set(appId, `Game (${appId})`);
        }
    }
}

// Modify displayIdleStatus function
function getIdleGamesLabel() {
    if (!config.games_to_idle || config.games_to_idle.length === 0) {
        return 'game(s)';
    }
    if (config.features.idle_multiple_games) {
        return config.games_to_idle.map(id => gameNames.get(id) || `Game (${id})`).join(', ');
    }
    return gameNames.get(config.games_to_idle[0]) || `Game (${config.games_to_idle[0]})`;
}

function displayIdleStatus() {
    if (!isIdling || !idleStartTime) return;

    const now = new Date();
    const diff = now - idleStartTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    // Create status line
    let statusText = `⏱️ ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} | 🎮 ${getIdleGamesLabel()}`; 
    statusText += ` | 👤 ${config.online_status}`;

    // Only update display if menu is not active
    if (!isMenuActive) {
        // Clear the current line and move cursor to start
        process.stdout.write('\r\x1b[K');
        process.stdout.write(clr.cyan(statusText));
    }
}

// Add function to get user profile info
async function getUserProfileInfo(steamID) {
    try {
        const response = await fetch(`https://steamcommunity.com/profiles/${steamID}/?xml=1`);
        const text = await response.text();
        const nameMatch = text.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
        const avatarMatch = text.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
        
        return {
            name: nameMatch ? nameMatch[1] : 'Unknown User',
            avatar: avatarMatch ? avatarMatch[1] : null
        };
    } catch (error) {
        console.log(`Error fetching profile for ${steamID}:`, error.message);
        return { name: 'Unknown User', avatar: null };
    }
}

// Modify handleFriendRequest function
async function handleFriendRequest(steamID, callback) {
    if (config.features.auto_accept_friends) {
        try {
            // Get user profile info
            const userInfo = await getUserProfileInfo(steamID);
            const timestamp = new Date().toLocaleString();
            
            // Create a more prominent notification
            console.log('\n' + '='.repeat(50));
            console.log('🎮 NEW FRIEND REQUEST 🎮');
            console.log('='.repeat(50));
            console.log(`From: ${userInfo.name}`);
            console.log(`Steam ID: ${steamID}`);
            console.log(`Time: ${timestamp}`);
            console.log(`Status: Auto-accepting...`);
            console.log('='.repeat(50) + '\n');
            
            steamUserInstance.addFriend(steamID, (err) => {
                if (err) {
                    console.log('\n' + '='.repeat(50));
                    console.log('❌ FRIEND REQUEST FAILED ❌');
                    console.log('='.repeat(50));
                    console.log(`From: ${userInfo.name}`);
                    console.log(`Steam ID: ${steamID}`);
                    console.log(`Error: ${err}`);
                    console.log('='.repeat(50) + '\n');
                    
                    if (tgBot) {
                        tgBot.sendMessage(config.tg_chat_id, `❌ Failed to accept friend request from ${userInfo.name} (${steamID}): ${err}`);
                    }
                } else {
                    console.log('\n' + '='.repeat(50));
                    console.log('✅ FRIEND REQUEST ACCEPTED ✅');
                    console.log('='.repeat(50));
                    console.log(`From: ${userInfo.name}`);
                    console.log(`Steam ID: ${steamID}`);
                    console.log(`Time: ${timestamp}`);
                    console.log('='.repeat(50) + '\n');
                    
                    if (tgBot) {
                        tgBot.sendMessage(config.tg_chat_id, `✅ Accepted friend request from ${userInfo.name} (${steamID})`);
                    }
                }
                if (callback) callback(err);
            });
        } catch (error) {
            console.log('\n' + '='.repeat(50));
            console.log('❌ ERROR PROCESSING FRIEND REQUEST ❌');
            console.log('='.repeat(50));
            console.log(`Steam ID: ${steamID}`);
            console.log(`Error: ${error}`);
            console.log('='.repeat(50) + '\n');
            
            if (callback) callback(error);
        }
    }
}

// Modify updateOnlineStatus function
function updateOnlineStatus() {
    const statusMap = {
        "Online": SteamUser.EPersonaState.Online,
        "Invisible": SteamUser.EPersonaState.Invisible
    };
    
    const status = statusMap[config.online_status] || SteamUser.EPersonaState.Online;
    
    if (steamUserInstance) {
        steamUserInstance.setPersona(status);
        console.log(`Steam status set to: ${config.online_status || 'Online'}`);
    }
}

// Modify configureOnlineStatus function
function configureOnlineStatus() {
    console.log("\n=== Configure Online Status ===");
    console.log("Current Status:", config.online_status);
    console.log("\n1. Set to Online");
    console.log("2. Set to Invisible");
    console.log("3. Return to Main Menu");
    
    rl.question("\nSelect an option (1-3): ", function(choice) {
        switch(choice) {
            case "1":
                config.online_status = "Online";
                saveConfig();
                console.log("Status set to: Online");
                updateOnlineStatus(); // Update status in real-time
                configureOnlineStatus();
                break;
            case "2":
                config.online_status = "Invisible";
                saveConfig();
                console.log("Status set to: Invisible");
                updateOnlineStatus(); // Update status in real-time
                configureOnlineStatus();
                break;
            case "3":
                showMenu();
                break;
            default:
                console.log("Invalid option. Please try again.");
                configureOnlineStatus();
        }
    });
}

// Modify checkIdleStatus function
function checkIdleStatus() {
    if (!isIdling) {
        console.log("\nNo active idling session.");
        showMenu();
        return;
    }

    isMenuActive = true; // Prevent main status updates while showing menu
    console.log("\n=== Current Idle Status ===");
    console.log("Press Enter to return to menu...");
    
    // Create a separate timer for status updates in check mode
    const checkTimer = setInterval(() => {
        const now = new Date();
        const diff = now - idleStartTime;
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        let statusText = `⏱️ ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} | 🎮 `;
        
        if (config.features.idle_multiple_games) {
            statusText += config.games_to_idle.map(id => gameNames.get(id) || `Game (${id})`).join(', ');
        } else {
            statusText += gameNames.get(config.games_to_idle[0]) || `Game (${config.games_to_idle[0]})`;
        }
        
        statusText += ` | 👤 ${config.online_status}`;
        
        // Clear previous status line and show new one
        process.stdout.write('\r\x1b[K');
        process.stdout.write(clr.cyan(statusText));
    }, 1000);

    // Wait for Enter key
    rl.question("", function() {
        clearInterval(checkTimer); // Stop the check timer
        isMenuActive = false;
        displayIdleStatus(); // Restore main status display
        showMenu();
    });
}

function readSteamRefreshToken() {
    return steamAuth.readToken();
}

function saveSteamRefreshToken(token) {
    try {
        steamAuth.saveToken(token);
    } catch (err) {
        console.log("Could not save Steam client session:", err.message);
    }
}

function clearSteamRefreshToken() {
    steamAuth.clearToken();
}

function questionAsync(promptText) {
    return new Promise((resolve) => {
        isEnteringSteamGuard = true;
        rl.question(promptText, (answer) => {
            isEnteringSteamGuard = false;
            resolve(answer);
        });
    });
}

function isRateLimitedLoginError(err) {
    return !!(err && (err.eresult === SteamUser.EResult.RateLimitExceeded || err.message === 'RateLimitExceeded'));
}

function isInvalidRefreshTokenError(err) {
    if (!err) return false;
    const code = err.eresult;
    return code === SteamUser.EResult.AccessDenied
        || code === SteamUser.EResult.Expired
        || code === SteamUser.EResult.InvalidPassword
        || code === SteamUser.EResult.InvalidParam
        || /refresh token/i.test(String(err.message || ''));
}

function applyPlayedGames() {
    if (!steamUserInstance) return;
    if (config.features.idle_multiple_games) {
        steamUserInstance.gamesPlayed(config.games_to_idle);
        console.log(clr.cyan(`Idling ${config.games_to_idle.length} games: ${config.games_to_idle.map(id => gameNames.get(id) || `Game (${id})`).join(', ')}`));
    } else if (config.features.idle_games) {
        steamUserInstance.gamesPlayed(config.games_to_idle[0]);
        console.log(clr.cyan(`Idling game: ${gameNames.get(config.games_to_idle[0]) || `Game (${config.games_to_idle[0]})`}`));
    }
}

function beginIdle() {
    if (!steamUserInstance || !steamUserInstance.steamID) return;
    if (isIdling) {
        applyPlayedGames();
        return;
    }

    isIdling = true;
    idleStartTime = new Date();
    isMenuActive = false;
    getGameNames(config.games_to_idle).catch(() => {});
    updateOnlineStatus();
    applyPlayedGames();
    console.log(clr.green("\nIdle timer started. Press M for the menu (idle keeps running). Press S to stop idling."));
    console.log("");
    if (idleTimer) {
        clearInterval(idleTimer);
    }
    idleTimer = setInterval(displayIdleStatus, 1000);
    displayIdleStatus();
}

function attachSteamUserHandlers() {
    steamUserInstance.on('loggedOn', () => {
        steamConnecting = false;
        idleLogonAttempts = 0;
        console.log(clr.green("Logged into Steam."));
        updateOnlineStatus();
        if (desiredSession.idle) {
            beginIdle();
        }
    });

    steamUserInstance.on('groupList', () => {
        const ids = Object.keys((steamUserInstance && steamUserInstance.myGroups) || {});
        if (ids.length) {
            console.log("Steam client loaded " + ids.length + " group ID(s).");
        }
    });

    steamUserInstance.on('webSession', (sessionID, cookies) => {
        if (!communityInstance) {
            communityInstance = new SteamCommunity({ timeout: 90000 });
        }
        try {
            communityInstance.setCookies(cookies);
        } catch (err) {
            console.log("Could not apply Steam web cookies:", err.message || err);
            return;
        }
        if (desiredSession.community && !steamUserInstance._communityStarted) {
            steamUserInstance._communityStarted = true;
            onLoginSuccess(communityInstance, config.username, null);
        }
    });

    steamUserInstance.on('loginKey', (key) => {
        saveSteamRefreshToken(key);
    });

    steamUserInstance.on('friendRelationship', async (steamID, relationship) => {
        if (relationship === SteamUser.EFriendRelationship.RequestRecipient) {
            try {
                const userInfo = await getUserProfileInfo(steamID);
                const timestamp = new Date().toLocaleString();

                console.log('\n' + '='.repeat(50));
                console.log('🎮 NEW FRIEND REQUEST RECEIVED 🎮');
                console.log('='.repeat(50));
                console.log(`From: ${userInfo.name}`);
                console.log(`Steam ID: ${steamID}`);
                console.log(`Time: ${timestamp}`);
                console.log(`Auto-accept: ${config.features.auto_accept_friends ? 'Enabled' : 'Disabled'}`);
                console.log('='.repeat(50) + '\n');

                if (tgBot) {
                    tgBot.sendMessage(config.tg_chat_id, `New friend request from ${userInfo.name} (${steamID})`);
                }

                if (config.features.auto_accept_friends) {
                    handleFriendRequest(steamID);
                }
            } catch (error) {
                console.log(`[${new Date().toLocaleString()}] Error processing friend request from ${steamID}:`, error);
            }
        }
    });

    steamUserInstance.on('error', (err) => {
        steamConnecting = false;
        if (idleTimer) {
            clearInterval(idleTimer);
            idleTimer = null;
        }

        if (isRateLimitedLoginError(err)) {
            const waitMs = Math.min(15 * 60 * 1000, 5 * 60 * 1000 * Math.max(1, idleLogonAttempts || 1));
            console.log(clr.yellow("\nSteam rate-limited login (too many logins too quickly)."));
            if (idleLogonAttempts >= 5) {
                console.log(clr.red("Gave up after several retries. Wait 15–30 minutes, then try again."));
                isIdling = false;
                return;
            }
            scheduleSteamReconnect(waitMs);
            return;
        }

        if (isInvalidRefreshTokenError(err)) {
            console.log(clr.yellow("Saved Steam session is no longer valid. You will need to authenticate once more."));
            clearSteamRefreshToken();
            isIdling = false;
            scheduleSteamReconnect(2000);
            return;
        }

        console.log(clr.red("\nSteam login error:"), err.message || err);
        isIdling = false;
    });

    steamUserInstance.on('loggedOff', () => {
        if (idleRetryTimer) return;
        if (!isIdling) return;
        console.log("\nSteam session ended");
        isIdling = false;
        if (idleTimer) {
            clearInterval(idleTimer);
            idleTimer = null;
        }
    });
}

function scheduleSteamReconnect(delayMs) {
    if (idleRetryTimer) {
        clearTimeout(idleRetryTimer);
        idleRetryTimer = null;
    }
    const waitMs = Math.max(0, delayMs || 0);
    if (waitMs > 0) {
        const minutes = (waitMs / 60000).toFixed(waitMs >= 60000 ? 0 : 1);
        console.log(`Waiting ${minutes} minute(s) before reconnecting...`);
        console.log("Leave this window open. Press 'M' for the menu, or option 5 later to cancel.");
    }
    idleRetryTimer = setTimeout(() => {
        idleRetryTimer = null;
        steamUserInstance = null;
        ensureLoggedIn(desiredSession);
    }, waitMs);
}

function connectSteamUser(token) {
    steamUserInstance = new SteamUser();
    attachSteamUserHandlers();
    idleLogonAttempts++;
    console.log(clr.cyan("Logging into Steam with saved session..."));
    try {
        steamUserInstance.logOn({
            refreshToken: token,
            logonID: 774411,
            machineName: 'DarkjoylessBot'
        });
    } catch (err) {
        steamConnecting = false;
        if (isInvalidRefreshTokenError(err)) {
            console.log(clr.yellow("Saved Steam session is no longer valid. You will need to authenticate once more."));
            clearSteamRefreshToken();
            scheduleSteamReconnect(2000);
            return;
        }
        console.log(clr.red("\nSteam login error:"), err.message || err);
        isIdling = false;
    }
}

function ensureLoggedIn(opts) {
    desiredSession = {
        idle: !!(opts && opts.idle),
        community: !!(opts && opts.community)
    };

    if (steamUserInstance && steamUserInstance.steamID) {
        if (desiredSession.idle) beginIdle();
        if (desiredSession.community) {
            if (communityInstance) {
                onLoginSuccess(communityInstance, config.username, null);
            } else {
                steamUserInstance.webLogOn();
            }
        }
        return;
    }

    if (steamConnecting) return;
    steamConnecting = true;

    steamAuth.getRefreshToken(config.username, config.password, questionAsync)
        .then((token) => {
            connectSteamUser(token);
        })
        .catch((err) => {
            steamConnecting = false;
            if (isRateLimitedLoginError(err)) {
                console.log("\nSteam is blocking new logins right now (too many attempts earlier).");
                console.log("Retrying keeps the block active, so this bot will not keep trying.");
                console.log("Wait 20–30 minutes, then choose option 2 again. You should get the authenticator prompt then.");
                isIdling = false;
                showMenu();
                return;
            }
            console.log("Steam login failed:", err.message || err);
            isIdling = false;
            showMenu();
        });
}

function startIdling() {
    if (isIdling && steamUserInstance && steamUserInstance.steamID) {
        console.log("Already idling games. Press S to stop, or M for the menu.");
        return;
    }
    isMenuActive = false;
    ensureLoggedIn({ idle: true, community: needsCommunitySession() });
}

function stopIdling(showMenuAfter = true) {
    if (idleRetryTimer) {
        clearTimeout(idleRetryTimer);
        idleRetryTimer = null;
    }

    if (!isIdling && !(steamUserInstance && steamUserInstance.steamID && (config.features.idle_games || config.features.idle_multiple_games))) {
        console.log("No active game idling session found.");
        if (showMenuAfter) showMenu();
        return;
    }

    console.log("\nStopping game idling...");
    if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = null;
    }
    process.stdout.write('\r\x1b[K');
    try {
        if (steamUserInstance) {
            steamUserInstance.gamesPlayed([]);
        }
    } catch (_) {}
    isIdling = false;
    idleStartTime = null;
    idleLogonAttempts = 0;
    desiredSession.idle = false;
    config.features.idle_games = false;
    config.features.idle_multiple_games = false;
    console.log(clr.yellow("Game idling stopped. Steam stays connected so you can use other menu features."));
    if (showMenuAfter) {
        showMenu();
    }
}

function stopFriendCommenter() {
    if (friendCommentTimer) {
        clearInterval(friendCommentTimer);
        friendCommentTimer = null;
    }
    if (friendCommentPendingTimeouts && friendCommentPendingTimeouts.length > 0) {
        friendCommentPendingTimeouts.forEach(t => clearTimeout(t));
        friendCommentPendingTimeouts = [];
    }
    config.features.auto_friend_comment = false;
}

function isFriendCommenterRunning() {
    return !!(friendCommentTimer || (friendCommentPendingTimeouts && friendCommentPendingTimeouts.length > 0));
}

function stopGroupCommenter() {
    groupCommenterStopRequested = true;
    if (groupCommentWarmupTimer) {
        clearTimeout(groupCommentWarmupTimer);
        groupCommentWarmupTimer = null;
    }
    if (groupCommentTimer) {
        clearInterval(groupCommentTimer);
        groupCommentTimer = null;
    }
    groupCycleRunning = false;
    config.features.auto_group_comment = false;
}

function isGroupCommenterRunning() {
    return !!(groupCommentTimer || groupCycleRunning || groupCommentWarmupTimer);
}

function scheduleGroupCommenter(community) {
    if (groupCommentWarmupTimer) {
        clearTimeout(groupCommentWarmupTimer);
        groupCommentWarmupTimer = null;
    }
    const warmupSec = Math.max(10, Number(config.group_start_delay) || 15);
    console.log("Starting group commenter (account groups from Steam client)...");
    console.log("Waiting " + warmupSec + "s for the group list...");
    groupCommenterStopRequested = false;
    config.features.auto_group_comment = true;
    groupCommentWarmupTimer = setTimeout(async () => {
        groupCommentWarmupTimer = null;
        if (groupCommenterStopRequested) return;
        try {
            await waitForMemberGroups();
            run(community, config.interval, config.groups, config.message);
        } catch (e) {
            console.log("An error occurred in the run function: %j", e);
            if (tgBot) {
                tgBot.sendMessage(config.tg_chat_id, "Critical error occurred in the run function: %j" + String(e));
            }
        }
    }, warmupSec * 1000);
}

function stopAllExceptIdle() {
    const stopped = [];
    if (isGroupCommenterRunning() || config.features.auto_group_comment) {
        stopGroupCommenter();
        stopped.push('group commenter');
    }
    if (isFriendCommenterRunning() || config.features.auto_friend_comment) {
        stopFriendCommenter();
        stopped.push('friend commenter');
    }
    if (stopped.length > 0) {
        console.log(clr.yellow("\nStopped " + stopped.join(' and ') + "." + (isIdling ? " Idling keeps running until you press S." : "")));
        saveConfig();
    }
}

function isRetryableSteamError(err) {
    if (!err) return false;
    const msg = err.message || String(err);
    return err.code === 429
        || msg.includes('HTTP error 429')
        || msg.includes('ETIMEDOUT')
        || msg.includes('ECONNRESET')
        || msg.includes('HTTP error 502')
        || msg.includes('HTTP error 503');
}

function getSteamUserWithRetry(community, steamID, callback, attempt = 1, maxAttempts = 5) {
    community.getSteamUser(steamID, function (err, user) {
        if (err && isRetryableSteamError(err) && attempt < maxAttempts) {
            const delayMs = err.code === 429 ? 5 * 60 * 1000 : Math.min(30000 * attempt, 120000);
            console.log(`Could not get steam user (attempt ${attempt}/${maxAttempts}): ${err}. Retrying in ${Math.round(delayMs / 1000)}s...`);
            setTimeout(() => getSteamUserWithRetry(community, steamID, callback, attempt + 1, maxAttempts), delayMs);
            return;
        }
        callback(err, user);
    });
}

function onLoginSuccess(community, accountName, user) {
    console.log("Logged on as " + accountName + "...");

    // Set status for commenting if enabled
    if (config.features.auto_group_comment) {
        updateOnlineStatus();
    }

    // JOIN UNLISTED GROUPS IF CONFIGURED
    if (config.join_unlisted_groups && user) {
        const userGroupIds = (user.groups || []).map(g => g.getSteamID64());

        console.log("Checking unlisted groups... Est. time: " + ((config.group_post_delay * config.groups.length) / 60).toFixed(1) + " min");
        config.groups.forEach((gid, i) => {
            setTimeout(() => {
                community.getSteamGroup(gid, function (err, group) {
                    if (err) {
                        console.log(`Could not get steam group: ${err}`);
                        return;
                    }
                    // Check if user is already in group
                    if (userGroupIds.includes(String(group.steamID))) {
                        console.log(`Already in group (${i + 1}/${config.groups.length}): ${gid}`);
                    } else {
                        community.joinGroup(group.steamID, (err) => {
                            if (err) {
                                console.log(`Could NOT JOIN group (${i + 1}/${config.groups.length}) ${gid}: ${err}`);
                            } else {
                                console.log(`Joined group (${i + 1}/${config.groups.length}): ${gid}`);
                            }
                        });
                    }
                });
            }, (config.group_join_delay * i) * 1000);
        });
    }

    // Start group commenting if enabled
    if (config.features.auto_group_comment) {
        scheduleGroupCommenter(community);
    }

    // Start friend profile commenting if enabled
    if (config.features.auto_friend_comment) {
        console.log("Starting random friend profile comments...")
        try {
            startFriendCommenterIfNeeded(community);
        } catch (e) {
            console.log("An error occurred in the friend commenter: %j", e);
            if (tgBot) {
                tgBot.sendMessage(config.tg_chat_id, "Critical error occurred in friend commenter: %j" + String(e));
            }
        }
    }

    // Add status message for currently active features
    const active = [];
    if (config.features.auto_group_comment) active.push('Group commenter (account groups)');
    if (config.features.auto_friend_comment) active.push('Auto Friend Commenter');
    if (config.features.idle_games || config.features.idle_multiple_games) active.push('Game Idling');
    if (active.length) {
        console.log("\nRunning features: " + active.join(', '));
    }
}

// Modify the existing doLogin function to handle both features
function doLogin(accountName, password, authCode, twoFactorCode, captcha) {
    communityInstance = new SteamCommunity({ timeout: 90000 });

    communityInstance.login({
        "accountName": accountName,
        "password": password,
        "authCode": authCode,
        "twoFactorCode": twoFactorCode,
        "captcha": captcha
    }, function (err) {
        if (err) {
            if (err.message == 'SteamGuardMobile') {
                isEnteringSteamGuard = true;
                rl.question("Steam Authenticator Code: ", function (code) {
                    isEnteringSteamGuard = false;
                    doLogin(accountName, password, null, code);
                });
                return;
            }

            if (err.message == 'SteamGuard') {
                isEnteringSteamGuard = true;
                console.log("An email has been sent to your address at " + err.emaildomain);
                rl.question("Steam Guard Code: ", function (code) {
                    isEnteringSteamGuard = false;
                    doLogin(accountName, password, code);
                });
                return;
            }

            if (err.message == 'CAPTCHA') {
                isEnteringSteamGuard = true;
                console.log(err.captchaurl);
                rl.question("CAPTCHA: ", function (captchaInput) {
                    isEnteringSteamGuard = false;
                    doLogin(accountName, password, authCode, twoFactorCode, captchaInput);
                });
                return;
            }

            // Handle incorrect Steam Guard code
            if (err.message.includes('Invalid Steam Guard code')) {
                console.log("\n❌ Incorrect Steam Guard code. Please try again.");
                isEnteringSteamGuard = true;
                rl.question("Steam Guard Code: ", function (code) {
                    isEnteringSteamGuard = false;
                    doLogin(accountName, password, code);
                });
                return;
            }

            // Handle incorrect Mobile Authenticator code
            if (err.message.includes('Invalid two-factor code')) {
                console.log("\n❌ Incorrect Mobile Authenticator code. Please try again.");
                isEnteringSteamGuard = true;
                rl.question("Steam Authenticator Code: ", function (code) {
                    isEnteringSteamGuard = false;
                    doLogin(accountName, password, null, code);
                });
                return;
            }

            console.log(err);
            process.exit(1);
        }

        // Only fetch profile XML when joining unlisted groups; otherwise skip an extra Steam request that often triggers 429s.
        const finishLogin = (user) => {
            setTimeout(() => onLoginSuccess(communityInstance, accountName, user), 5000);
        };

        if (config.join_unlisted_groups) {
            getSteamUserWithRetry(communityInstance, communityInstance.steamID, function (err, user) {
                if (err) {
                    console.log('Could not get steam user: ' + err);
                    process.exit(1);
                }
                finishLogin(user);
            });
        } else {
            console.log("Login successful. Waiting 5s before starting to avoid Steam rate limits...");
            finishLogin(null);
        }
    });
}


function groupCacheKey(gid) {
    return String(gid || '').toLowerCase();
}

function persistGroupCache() {
    try {
        fs.writeFileSync(GROUP_CACHE_PATH, JSON.stringify(groupIdCache, null, 2));
    } catch (_) {}
}

function rememberGroup(gid, group) {
    if (!group) return;
    const entry = {
        steamID: String(group.steamID),
        name: group.name || String(gid),
        url: group.url || String(gid)
    };
    groupIdCache[groupCacheKey(gid)] = entry;
    if (group.url) groupIdCache[groupCacheKey(group.url)] = entry;
    persistGroupCache();
}

function cachedGroup(gid) {
    return groupIdCache[groupCacheKey(gid)] || null;
}

function groupLabel(group, gid) {
    if (group && group.name) {
        const label = group.url ? (group.name + " [" + group.url + "]") : group.name;
        if (gid) groupNameCache.set(String(gid), label);
        if (group.url) groupNameCache.set(String(group.url), label);
        if (group.steamID) groupNameCache.set(String(group.steamID), label);
        return label;
    }
    const cached = cachedGroup(gid);
    if (cached) {
        return cached.name + (cached.url ? " [" + cached.url + "]" : "");
    }
    const key = String(gid || (group && group.steamID) || '');
    return groupNameCache.get(key) || key;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSteamRateLimitError(err) {
    if (!err) return false;
    return err.code === 429 || /HTTP error 429/i.test(String(err.message || ''));
}

function resolveGroupFromSteamUser(gid) {
    if (!steamUserInstance) return null;
    const raw = String(gid || '');
    const slug = raw.toLowerCase();
    if (/^10358279\d+$/.test(raw)) {
        const info = steamUserInstance.groups && steamUserInstance.groups[raw];
        const name = info && info.name_info && info.name_info.clan_name;
        return { steamID: raw, name: name || raw, url: raw };
    }
    const myGroups = steamUserInstance.myGroups || {};
    const groups = steamUserInstance.groups || {};
    const compactSlug = slug.replace(/[^a-z0-9]/g, '');
    for (const sid of Object.keys(myGroups)) {
        const info = groups[sid];
        const clanName = (info && info.name_info && info.name_info.clan_name) || '';
        const lower = clanName.toLowerCase();
        const compact = lower.replace(/[^a-z0-9]/g, '');
        if (lower === slug || compact === compactSlug) {
            return { steamID: sid, name: clanName, url: raw };
        }
    }
    return null;
}

function rememberResolvedGroup(gid, resolved) {
    if (!resolved || !resolved.steamID) return;
    const entry = {
        steamID: String(resolved.steamID),
        name: resolved.name || String(gid),
        url: resolved.url || String(gid)
    };
    groupIdCache[groupCacheKey(gid)] = entry;
    if (entry.url) groupIdCache[groupCacheKey(entry.url)] = entry;
    persistGroupCache();
}

function isClanSteamId(value) {
    return /^10358279\d+$/.test(String(value || ''));
}

function normalizeGroupKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clientGroupName(steamID) {
    const info = steamUserInstance && steamUserInstance.groups && steamUserInstance.groups[steamID];
    const name = info && info.name_info && info.name_info.clan_name;
    return name || String(steamID);
}

function memberGroupIds() {
    const mine = (steamUserInstance && steamUserInstance.myGroups) || {};
    const members = Object.keys(mine).filter((id) => mine[id] === SteamUser.EClanRelationship.Member);
    if (members.length) return members;
    return Object.keys(mine).filter((id) => {
        const rel = mine[id];
        return rel
            && rel !== SteamUser.EClanRelationship.None
            && rel !== SteamUser.EClanRelationship.Blocked
            && rel !== SteamUser.EClanRelationship.Kicked
            && rel !== SteamUser.EClanRelationship.KickAcknowledged;
    });
}

function waitForMemberGroups(timeoutMs = 20000) {
    return new Promise((resolve) => {
        const finish = () => resolve(memberGroupIds());
        if (memberGroupIds().length) {
            setTimeout(finish, 1500);
            return;
        }
        if (!steamUserInstance) {
            finish();
            return;
        }
        const timer = setTimeout(finish, timeoutMs);
        steamUserInstance.once('groupList', () => {
            clearTimeout(timer);
            setTimeout(finish, 2000);
        });
    });
}

function groupFilterKeys(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const keys = [normalizeGroupKey(raw)];
    if (isClanSteamId(raw)) keys.push(raw);
    const cached = cachedGroup(raw);
    if (cached && cached.steamID) keys.push(normalizeGroupKey(cached.steamID), normalizeGroupKey(cached.name), normalizeGroupKey(cached.url));
    return keys.filter(Boolean);
}

function memberMatchesFilter(member, filterValues) {
    const memberKeys = [
        normalizeGroupKey(member.steamID),
        normalizeGroupKey(member.name),
        String(member.steamID)
    ];
    for (let i = 0; i < filterValues.length; i++) {
        const wantKeys = groupFilterKeys(filterValues[i]);
        for (let k = 0; k < wantKeys.length; k++) {
            if (memberKeys.indexOf(wantKeys[k]) !== -1) return true;
        }
        if (isClanSteamId(filterValues[i]) && String(member.steamID) === String(filterValues[i])) return true;
        const cached = cachedGroup(filterValues[i]);
        if (cached && String(cached.steamID) === String(member.steamID)) return true;
    }
    return false;
}

function getAccountGroupTargets() {
    const members = memberGroupIds().map((steamID) => ({
        steamID,
        name: clientGroupName(steamID)
    }));
    if (!members.length) {
        console.log(clr.yellow("This Steam account has no groups in the client list yet. Join groups, restart, and try option 1 again."));
        return [];
    }

    const includeList = []
        .concat(config.groups || [])
        .concat(config.group_names || [])
        .map(String)
        .filter(Boolean);
    const excludeList = []
        .concat(config.groups_excluded || [])
        .concat(config.group_names_excluded || [])
        .map(String)
        .filter(Boolean);

    let targets = members.filter((m) => !memberMatchesFilter(m, excludeList));
    const excludedCount = members.length - targets.length;
    if (excludedCount > 0) {
        console.log("Skipping " + excludedCount + " excluded group(s) from config.");
    }

    if (includeList.length) {
        const matched = targets.filter((m) => memberMatchesFilter(m, includeList));
        if (matched.length) {
            matched.forEach((m) => rememberResolvedGroup(m.name || m.steamID, m));
            console.log("Group commenter: " + matched.length + " of " + members.length + " account groups (config include/exclude).");
            return matched;
        }
        const includeUrls = (config.groups || []).map(String).filter(Boolean);
        if (excludeList.length) {
            console.log("Could not match include names; posting to account groups minus excluded.");
            return targets;
        }
        if (includeUrls.length > 0 && includeUrls.length < members.length) {
            console.log(clr.yellow("Could not match config.groups to Steam client group names. Not posting to every group, so ignored groups stay ignored."));
            console.log("Client groups: " + targets.map((m) => m.name).join(", "));
            console.log("Config include list: " + includeUrls.join(", "));
            return [];
        }
    }

    console.log("Group commenter: " + targets.length + " group(s) from this Steam account.");
    return targets;
}

function pauseGroupQueue(label) {
    lastGroupRateLimitAt = Date.now();
    groupPostPausedUntil = Date.now() + 10 * 60 * 1000;
    console.log(clr.yellow("Rate limited " + label + ". Pausing all group posts for 10 minutes, then retrying. Press M to stop comments."));
    console.log(clr.dim("Steam is blocking group page lookups (often after configure-bot or a fresh login). Leave this window open."));
}

function waitForGroupPostPause() {
    const wait = groupPostPausedUntil - Date.now();
    if (wait <= 0) return Promise.resolve();
    console.log("Waiting " + Math.ceil(wait / 1000) + "s for Steam rate limit to clear...");
    return sleep(wait);
}

function postGroupComment(community, gid, message) {
    const fallbackName = groupLabel(null, gid);

    const loadPastebin = () => fetch(config.pastebinURL).then(res => res.text());

    return (async () => {
        while (!groupCommenterStopRequested) {
            await waitForGroupPostPause();
            if (groupCommenterStopRequested) return 'stopped';

            const cached = cachedGroup(gid);
            let steamID = (cached && cached.steamID) || (isClanSteamId(gid) ? String(gid) : null);
            let display = (cached && cached.name) || fallbackName;

            if (!steamID) {
                const fromClient = resolveGroupFromSteamUser(gid);
                if (fromClient && fromClient.steamID) {
                    rememberResolvedGroup(gid, fromClient);
                    steamID = fromClient.steamID;
                    display = fromClient.name || fallbackName;
                }
            }

            if (!steamID) {
                console.log(clr.yellow("Skipping '" + fallbackName + "' — no group ID from Steam client. Web group lookup is disabled (Steam 429s it)."));
                return 'error';
            }

            let postMessage = message;
            if (config.usePastebin) {
                try {
                    postMessage = await loadPastebin();
                } catch (e) {
                    console.log("Could not fetch pastebin message:", e.message || e);
                    return 'error';
                }
            }

            console.log("Posting to " + display + "...");
            const result = await doComment(null, postMessage, gid, community, steamID);
            if (result === 'rate_limited') continue;
            return result;
        }
        return 'stopped';
    })();
}

/**
 * Post a comment to a user's Steam profile
 * @param {SteamCommunity} community
 * @param {String} steamId64
 * @param {String} message
 */
function postProfileComment(community, steamId64, message, onDone) {
    // Some steamcommunity versions expose postUserComment directly
    if (typeof community.postUserComment === 'function') {
        community.postUserComment(steamId64, message, function (err) {
            if (err) {
                if (err.code === 429) {
                    console.log(clr.yellow(`Rate limited when posting to user ${steamId64}. Waiting 5 minutes before retrying...`));
                    if (onDone) try { onDone('deferred'); } catch (_) {}
                    setTimeout(() => postProfileComment(community, steamId64, message, null), 5 * 60 * 1000);
                    return;
                }
                const msg = err && (err.message || String(err));
                if (msg && (msg.includes('do not allow you to add comments') || msg.includes('disabled') || msg.includes('not allow'))) {
                    getFriendDisplayName(steamId64).then((name) => {
                        console.log(`⏭️ Skipping friend (comments disabled): ${name} (${steamId64})`);
                    }).catch(() => {
                        console.log(`⏭️ Skipping friend (comments disabled): ${steamId64}`);
                    });
                    if (onDone) try { onDone('skipped'); } catch (_) {}
                    return;
                }
                console.log(`Could not post comment to user ${steamId64}:`, err);
                if (onDone) try { onDone('error'); } catch (_) {}
                return;
            }
            getFriendDisplayName(steamId64).then((name) => {
                console.log(clr.green(`✅ Comment posted on friend: ${name} (${steamId64}) at ${new Date().toLocaleString()}`));
            }).catch(() => {
                console.log(clr.green("✅ Comment posted on user profile: " + steamId64 + " at " + new Date().toLocaleString()));
            });
            if (onDone) try { onDone('success'); } catch (_) {}
        });
        return;
    }

    // Fallback: try to load the user and call comment() if available
    try {
        community.getSteamUser(new SteamCommunity.SteamID(steamId64), function (err, user) {
            if (err) {
                console.log(`Could not get steam user ${steamId64}:`, err);
                return;
            }
            if (user && typeof user.comment === 'function') {
                user.comment(message, function (err2) {
                    if (err2) {
                        if (err2.code === 429) {
                            console.log(clr.yellow(`Rate limited when posting to user ${steamId64}. Waiting 5 minutes before retrying...`));
                            if (onDone) try { onDone('deferred'); } catch (_) {}
                            setTimeout(() => postProfileComment(community, steamId64, message, null), 5 * 60 * 1000);
                            return;
                        }
                        const msg = err2 && (err2.message || String(err2));
                        if (msg && (msg.includes('do not allow you to add comments') || msg.includes('disabled') || msg.includes('not allow'))) {
                            getFriendDisplayName(steamId64).then((name) => {
                                console.log(`⏭️ Skipping friend (comments disabled): ${name} (${steamId64})`);
                            }).catch(() => {
                                console.log(`⏭️ Skipping friend (comments disabled): ${steamId64}`);
                            });
                            if (onDone) try { onDone('skipped'); } catch (_) {}
                            return;
                        }
                        console.log(`Could not post comment to user ${steamId64}:`, err2);
                        if (onDone) try { onDone('error'); } catch (_) {}
                        return;
                    }
                    getFriendDisplayName(steamId64).then((name) => {
                        console.log(clr.green(`✅ Comment posted on friend: ${name} (${steamId64}) at ${new Date().toLocaleString()}`));
                    }).catch(() => {
                        console.log(clr.green("✅ Comment posted on user profile: " + steamId64 + " at " + new Date().toLocaleString()));
                    });
                    if (onDone) try { onDone('success'); } catch (_) {}
                });
            } else {
                console.log(`User object for ${steamId64} does not support commenting via this API version.`);
                if (onDone) try { onDone('error'); } catch (_) {}
            }
        });
    } catch (e) {
        console.log(`Unexpected error posting profile comment to ${steamId64}:`, e);
        if (onDone) try { onDone('error'); } catch (_) {}
    }
}

async function getFriendDisplayName(steamId64) {
    try {
        const key = String(steamId64);
        if (friendNameCache.has(key)) {
            return friendNameCache.get(key);
        }
        const info = await getUserProfileInfo(steamId64);
        const name = info && info.name ? info.name : 'Unknown User';
        friendNameCache.set(key, name);
        return name;
    } catch (_) {
        return 'Unknown User';
    }
}

/**
 * Fetch list of friend SteamIDs using SteamUser. Reuses existing session if available.
 * Creates a temporary SteamUser session otherwise.
 * @returns {Promise<string[]>}
 */
function fetchFriendIds(community) {
    return new Promise((resolve) => {
        // First try via SteamCommunity web endpoint (works with current community session)
        try {
            community.getFriendsList((err, relationships) => {
                if (!err && relationships && Object.keys(relationships).length > 0) {
                    const ids = Object.keys(relationships).filter(id => relationships[id] === SteamUser.EFriendRelationship.Friend);
                    resolve(ids);
                    return;
                }

                if (err) {
                    console.log("Community getFriendsList failed, falling back to SteamUser:", err.message || err);
                } else {
                    console.log("Community friends list empty or malformed, falling back to SteamUser...");
                }

                // Fallback to SteamUser relationships
                const extractFromSteamUser = () => {
                    try {
                        const friendsMap = steamUserInstance && steamUserInstance.myFriends ? steamUserInstance.myFriends : {};
                        const friendIds = Object.keys(friendsMap).filter(id => friendsMap[id] === SteamUser.EFriendRelationship.Friend);
                        resolve(friendIds);
                    } catch (e2) {
                        console.log("Failed to extract friends from SteamUser:", e2);
                        resolve([]);
                    }
                };

                if (steamUserInstance) {
                    if (steamUserInstance.myFriends && Object.keys(steamUserInstance.myFriends).length > 0) {
                        extractFromSteamUser();
                    } else {
                        const timeout = setTimeout(extractFromSteamUser, 5000);
                        const handler = () => {
                            clearTimeout(timeout);
                            steamUserInstance.removeListener('relationships', handler);
                            extractFromSteamUser();
                        };
                        steamUserInstance.on('relationships', handler);
                    }
                    return;
                }

                // Create temp SteamUser as last resort
                const tempUser = new SteamUser();
                tempUser.logOn({ accountName: config.username, password: config.password });

                const cleanupAndResolve = (ids) => {
                    try { tempUser.logOff(); } catch (_) {}
                    resolve(ids || []);
                };

                let relationshipsLoaded = false;
                tempUser.on('relationships', () => {
                    relationshipsLoaded = true;
                    try {
                        const ids2 = Object.keys(tempUser.myFriends).filter(id => tempUser.myFriends[id] === SteamUser.EFriendRelationship.Friend);
                        cleanupAndResolve(ids2);
                    } catch (e3) {
                        console.log("Error reading temporary friends list:", e3);
                        cleanupAndResolve([]);
                    }
                });
                tempUser.on('error', (err2) => {
                    console.log("Temporary SteamUser error while fetching friends:", err2);
                    cleanupAndResolve([]);
                });
                setTimeout(() => { if (!relationshipsLoaded) cleanupAndResolve([]); }, 10000);
            });
        } catch (e) {
            console.log("Unexpected error when fetching friends:", e);
            resolve([]);
        }
    });
}

function shuffleArray(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
    }
    return copy;
}

function randomFriendDelayMs() {
    const base = (config.friend_post_delay || 60) * 1000;
    const jitter = 0.5 + Math.random();
    return Math.max(15000, Math.round(base * jitter));
}

function startFriendCommenterIfNeeded(community) {
    if (friendCommentTimer) {
        console.log("Friend commenter already running in the background.");
        return;
    }
    runFriendCommenter(community, config.interval, getFriendCommentMessage());
}

/**
 * Scheduler to post comments on friends' profiles on an interval
 */
function runFriendCommenter(community, interval, message) {
    if (friendCommentTimer) {
        stopFriendCommenter();
    }

    let tick = 0;

    const doCycle = async () => {
        if (!config.features.auto_friend_comment) return;
        console.log("Posting to friends on interval " + tick + " (random order)");
        tick++;

        const allFriendIds = await fetchFriendIds(community);
        if (!allFriendIds || allFriendIds.length === 0) {
            console.log("No friends found or failed to fetch friend list.");
            return;
        }

        const excluded = new Set((config.friends_excluded || []).map(String));
        const targetIds = shuffleArray(allFriendIds.filter(id => !excluded.has(String(id))));
        console.log(`Will post to ${targetIds.length}/${allFriendIds.length} friends in random order (excluding ${excluded.size}).`);

        let completed = 0;
        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let delay = 0;
        friendCommentPendingTimeouts = targetIds.map((steamId) => {
            delay += randomFriendDelayMs();
            const t = setTimeout(async () => {
                try {
                    const displayName = await getFriendDisplayName(steamId);
                    console.log(`→ Posting to friend: ${displayName} (${steamId})`);
                } catch (_) {}
                postProfileComment(community, steamId, message, (result) => {
                    completed++;
                    if (result === 'success') successCount++;
                    else if (result === 'skipped') skippedCount++;
                    else if (result === 'error') errorCount++;
                    if (completed === targetIds.length) {
                        console.log(`\nFinished friend commenting cycle: ${successCount} success, ${skippedCount} skipped, ${errorCount} errors.`);
                    }
                });
            }, delay);
            return t;
        });
    };

    doCycle();
    friendCommentTimer = setInterval(doCycle, interval * 1000);
}
/**
 * Helper function to decrease code duplication in postGroupComment
 * @param {SteamGroup} group - SteamCommunity instance for an authenticated user
 * @param {String} message - Message to post
 */
function doComment(group, message, gid, community, steamID) {
    return new Promise((resolve) => {
        const name = groupLabel(group, gid);
        const done = function (err) {
            if (err) {
                if (err.code === 429 || isSteamRateLimitError(err)) {
                    lastGroupRateLimitAt = Date.now();
                    groupPostPausedUntil = Date.now() + 10 * 60 * 1000;
                    console.log(clr.yellow("Rate limited when posting to group " + name + ". Pausing all group posts for 10 minutes..."));
                    resolve('rate_limited');
                    return;
                }
                console.log(clr.red("Could not post comment to group " + name + ": " + (err.message || err)));
                resolve('error');
                return;
            }

            console.log(clr.green("Comment posted on group: " + name + " at " + new Date().toLocaleString()));
            resolve('success');
        };
        if (group && typeof group.comment === 'function') {
            group.comment(message, done);
        } else {
            community.postGroupComment(steamID, message, done);
        }
    });
}

/**
 * Post comments to an array of Steam groups on a specified interval
 * @param {SteamCommunity} community - SteamCommunity instance for an authenticated user
 * @param {Number} intervalSeconds - Seconds between each series of posts
 * @param {Array} groups -  Array of Steam group IDs
 * @param {String} message - Message to post
 */
function run(community, intervalSeconds, groups, message) {
    stopGroupCommenter();
    groupCommenterStopRequested = false;
    config.features.auto_group_comment = true;

    const delayMs = Math.max(60, Number(intervalSeconds) || 28800) * 1000;
    let cycleId = 0;

    const runCycle = async () => {
        if (groupCommenterStopRequested) return;
        if (groupCycleRunning) {
            console.log("Previous group commenting cycle still running; skipping this tick.");
            return;
        }
        groupCycleRunning = true;
        const thisCycle = cycleId++;
        console.log("Group comment cycle " + thisCycle);

        try {
            const targets = getAccountGroupTargets();
            if (!targets.length) {
                console.log(clr.yellow("No account groups available yet. Will try again next interval."));
                return;
            }
            let posted = 0;
            let skipped = 0;
            let failed = 0;
            let stoppedEarly = false;
            for (let i = 0; i < targets.length; i++) {
                if (groupCommenterStopRequested) {
                    stoppedEarly = true;
                    console.log(clr.yellow("Group commenter stopped."));
                    break;
                }
                await waitForGroupPostPause();
                if (groupCommenterStopRequested) {
                    stoppedEarly = true;
                    break;
                }
                const target = targets[i];
                rememberResolvedGroup(target.url || target.steamID, target);
                console.log(clr.cyan("→ Group " + (i + 1) + "/" + targets.length + ": " + (target.name || target.steamID)));
                const result = await postGroupComment(community, target.steamID, message);
                if (result === 'success') posted++;
                else if (result === 'stopped') {
                    stoppedEarly = true;
                    break;
                } else if (result === 'skipped') skipped++;
                else failed++;
                if (i < targets.length - 1 && !groupCommenterStopRequested) {
                    const gap = Math.max(30, Number(config.group_post_delay) || 30) * 1000;
                    await sleep(gap);
                }
            }
            if (!stoppedEarly && !groupCommenterStopRequested) {
                if (posted === targets.length && failed === 0) {
                    console.log(clr.green("Posted on all " + targets.length + " groups."));
                } else {
                    console.log(clr.green("Finished posting to groups: " + posted + " posted, " + skipped + " skipped, " + failed + " failed (of " + targets.length + ")."));
                }
            }
        } catch (e) {
            console.log("An error occurred in the group comment cycle:", e);
        } finally {
            groupCycleRunning = false;
        }
    };

    runCycle();
    groupCommentTimer = setInterval(runCycle, delayMs);
}

// Add function to get a single game name
async function getGameName(appId) {
    try {
        const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
        const data = await response.json();
        
        if (data && data[appId] && data[appId].success && data[appId].data && data[appId].data.name) {
            return data[appId].data.name;
        } else {
            throw new Error('Game not found');
        }
    } catch (error) {
        console.log(`Error fetching game name for ${appId}:`, error.message);
        throw error;
    }
}

// Add function to configure saved games
async function configureSavedGames() {
    console.log("\n=== Configure Saved Games ===");
    console.log("1. Set Single Game");
    console.log("2. Set Multiple Games");
    console.log("3. Toggle Use Saved Games");
    console.log("4. View Current Settings");
    console.log("5. Return to Main Menu");

    rl.question("\nSelect an option: ", async function(choice) {
        switch(choice) {
            case "1":
                rl.question("Enter the AppID of the game to idle (e.g. 730 for CS2): ", async function(appId) {
                    const gameId = parseInt(appId);
                    try {
                        const gameName = await getGameName(gameId);
                        console.log(`\nGame found: ${gameName} (AppID: ${gameId})`);
                        config.saved_games.single_game = gameId;
                        saveConfig();
                        console.log("Single game saved successfully!");
                    } catch (error) {
                        console.log(`Error: Could not find game with AppID ${gameId}`);
                    }
                    configureSavedGames();
                });
                break;
            case "2":
                rl.question("Enter AppIDs separated by commas (e.g. 730,440,570): ", async function(appIds) {
                    const gameIds = appIds.split(',').map(id => parseInt(id.trim()));
                    console.log("\nFetching game names...");
                    try {
                        const gameNames = await Promise.all(gameIds.map(async (id) => {
                            try {
                                const name = await getGameName(id);
                                return `${name} (${id})`;
                            } catch (error) {
                                return `Unknown Game (${id})`;
                            }
                        }));
                        console.log("\nGames found:");
                        gameNames.forEach(name => console.log(`- ${name}`));
                        config.saved_games.multiple_games = gameIds;
                        saveConfig();
                        console.log("\nMultiple games saved successfully!");
                    } catch (error) {
                        console.log("Error: Could not fetch some game names");
                    }
                    configureSavedGames();
                });
                break;
            case "3":
                config.features.use_saved_games = !config.features.use_saved_games;
                saveConfig();
                console.log(`Use saved games is now ${config.features.use_saved_games ? 'enabled' : 'disabled'}`);
                configureSavedGames();
                break;
            case "4":
                console.log("\nCurrent Saved Games Settings:");
                console.log(`Use Saved Games: ${config.features.use_saved_games ? 'Enabled' : 'Disabled'}`);
                
                if (config.saved_games.single_game) {
                    try {
                        const singleGameName = await getGameName(config.saved_games.single_game);
                        console.log(`Single Game: ${singleGameName} (AppID: ${config.saved_games.single_game})`);
                    } catch (error) {
                        console.log(`Single Game: Unknown Game (AppID: ${config.saved_games.single_game})`);
                    }
                } else {
                    console.log("Single Game: Not set");
                }

                if (config.saved_games.multiple_games && config.saved_games.multiple_games.length > 0) {
                    console.log("\nMultiple Games:");
                    try {
                        const gameNames = await Promise.all(config.saved_games.multiple_games.map(async (id) => {
                            try {
                                const name = await getGameName(id);
                                return `${name} (${id})`;
                            } catch (error) {
                                return `Unknown Game (${id})`;
                            }
                        }));
                        gameNames.forEach(name => console.log(`- ${name}`));
                    } catch (error) {
                        console.log("Error: Could not fetch some game names");
                    }
                } else {
                    console.log("Multiple Games: Not set");
                }
                configureSavedGames();
                break;
            case "5":
                showMenu();
                break;
            default:
                console.log("Invalid option. Please try again.");
                configureSavedGames();
        }
    });
}

// Add function to save config
function saveConfig() {
    try {
        encryption.persistEncryptedConfig(CONFIG_PATH, config);
        console.log("Configuration saved successfully.");
    } catch (error) {
        console.log("Error saving configuration:", error);
    }
}

// Add function to configure friend request settings
function configureFriendRequests() {
    console.log("\n=== Configure Friend Requests ===");
    console.log("1. Toggle Auto-Accept Friend Requests");
    console.log("2. View Current Settings");
    console.log("3. Back to Main Menu");
    
    rl.question("\nSelect an option (1-3): ", function(choice) {
        switch(choice) {
            case "1":
                config.features.auto_accept_friends = !config.features.auto_accept_friends;
                console.log(`Auto-accept friend requests is now: ${config.features.auto_accept_friends ? 'enabled' : 'disabled'}`);
                saveConfig();
                configureFriendRequests();
                break;
            case "2":
                console.log("\nCurrent Friend Request Settings:");
                console.log(`Auto-Accept Friend Requests: ${config.features.auto_accept_friends ? 'Enabled' : 'Disabled'}`);
                configureFriendRequests();
                break;
            case "3":
                showMenu();
                break;
            default:
                console.log("Invalid option. Please try again.");
                configureFriendRequests();
        }
    });
}

// Add new menu system
function showMenu() {
    isMenuActive = true;
    if (isIdling) {
        process.stdout.write('\r\x1b[K');
    }

    console.log("\n" + clr.cyan(clr.bold("=== Darkjoyless Steam Bot Menu ===")));
    const running = [];
    if (isIdling) running.push("Idling: " + getIdleGamesLabel());
    if (isGroupCommenterRunning()) running.push("Group commenter (account groups)");
    if (isFriendCommenterRunning()) running.push("Friend commenter");
    if (running.length) {
        console.log(clr.green("Running: " + running.join(" | ")));
        console.log("");
    }
    console.log(clr.cyan("1.") + " Group commenter (all groups on this account)");
    console.log(clr.cyan("2.") + " Idle Single Game");
    console.log(clr.cyan("3.") + " Idle Multiple Games");
    console.log(clr.cyan("4.") + " Group commenter + Friend commenter");
    console.log(clr.yellow("5.") + " Stop Idling");
    console.log(clr.cyan("6.") + " Configure Saved Games");
    console.log(clr.cyan("7.") + " Configure Friend Requests");
    console.log(clr.cyan("8.") + " Configure Online Status");
    console.log(clr.cyan("9.") + " Run Friend Commenter Only");
    console.log(clr.cyan("10.") + " Check Idle Status");
    console.log(clr.yellow("11.") + " Stop comments/groups (keep idling)");
    console.log(clr.red("12.") + " Exit");
    console.log(clr.dim("\nM = main menu (stops comments/groups, idle keeps running)"));
    console.log(clr.dim("S = stop idling    ESC = exit"));

    rl.question("\nSelect an option (1-12): ", function(choice) {
        const picked = String(choice || '').trim().toLowerCase();
        switch(picked) {
            case "1":
                isMenuActive = false;
                stopFriendCommenter();
                config.features.auto_group_comment = true;
                config.features.auto_friend_comment = false;
                saveConfig();
                startBot();
                break;
            case "2":
                stopAllExceptIdle();
                config.features.idle_games = true;
                config.features.idle_multiple_games = false;
                config.features.auto_friend_comment = false;
                config.features.auto_group_comment = false;
                saveConfig();
                if (config.features.use_saved_games && config.saved_games.single_game) {
                    console.log(`Using saved single game: ${config.saved_games.single_game}`);
                    config.games_to_idle = [config.saved_games.single_game];
                    startBot();
                } else {
                    rl.question("Enter the AppID of the game to idle: ", function(appId) {
                        config.games_to_idle = [parseInt(appId)];
                        startBot();
                    });
                }
                break;
            case "3":
                stopAllExceptIdle();
                config.features.idle_games = false;
                config.features.idle_multiple_games = true;
                config.features.auto_friend_comment = false;
                config.features.auto_group_comment = false;
                saveConfig();
                if (config.features.use_saved_games && config.saved_games.multiple_games && config.saved_games.multiple_games.length > 0) {
                    console.log(`Using saved multiple games: ${config.saved_games.multiple_games.join(', ')}`);
                    config.games_to_idle = config.saved_games.multiple_games;
                    startBot();
                } else {
                    rl.question("Enter AppIDs separated by commas: ", function(appIds) {
                        config.games_to_idle = appIds.split(',').map(id => parseInt(id.trim()));
                        startBot();
                    });
                }
                break;
            case "4":
                isMenuActive = false;
                config.features.auto_group_comment = true;
                config.features.auto_friend_comment = true;
                saveConfig();
                startBot();
                break;
            case "5":
            case "s":
                stopIdling();
                break;
            case "6":
                configureSavedGames();
                break;
            case "7":
                configureFriendRequests();
                break;
            case "8":
                configureOnlineStatus();
                break;
            case "9":
                isMenuActive = false;
                stopGroupCommenter();
                config.features.auto_group_comment = false;
                config.features.auto_friend_comment = true;
                saveConfig();
                if (communityInstance) {
                    stopFriendCommenter();
                    config.features.auto_friend_comment = true;
                    runFriendCommenter(communityInstance, config.interval, getFriendCommentMessage());
                    console.log(clr.green("Friend commenter started." + (isIdling ? " Idling keeps running." : "")));
                    showMenu();
                } else {
                    startBot();
                }
                break;
            case "10":
                checkIdleStatus();
                break;
            case "11":
                stopAllExceptIdle();
                showMenu();
                break;
            case "12":
                console.log(clr.red("Exiting..."));
                process.exit(0);
                break;
            default:
                console.log("Invalid option. Please try again.");
                showMenu();
        }
    });
}

function needsCommunitySession() {
    return !!(config.features.auto_group_comment || config.features.auto_friend_comment || config.join_unlisted_groups);
}

function startBot() {
    if (!config.username || !config.password) {
        console.log("Invalid config for user " + config.username);
        return;
    }

    const wantIdle = !!(config.features.idle_games || config.features.idle_multiple_games);
    const wantCommunity = needsCommunitySession();
    console.log("Starting Steam session for " + config.username + "...");
    ensureLoggedIn({ idle: wantIdle, community: wantCommunity });
}

function toggleFriendCommenter() {
    config.features.auto_friend_comment = !config.features.auto_friend_comment;
    saveConfig();
    if (config.features.auto_friend_comment) {
        console.log("Friend commenter enabled. Starting...");
        if (communityInstance) {
            runFriendCommenter(communityInstance, config.interval, getFriendCommentMessage());
        } else {
            // Authenticate to obtain community instance
            startBot();
        }
    } else {
        console.log("Friend commenter disabled. Stopping...");
        stopFriendCommenter();
    }
    showMenu();
}

function getFriendCommentMessage() {
    if (config.friend_message && typeof config.friend_message === 'string' && config.friend_message.trim().length > 0) {
        return config.friend_message;
    }
    try {
        const friendMsg = fs.readFileSync('./config/friendcomment.txt', 'utf8');
        if (friendMsg && friendMsg.trim().length > 0) {
            return friendMsg;
        }
    } catch (_) {}
    console.log("Friend comment message not set; falling back to main message.");
    return config.message;
}

// Modify the main execution to show menu first
if (config.username && config.password && config.groups.length > 0) {
	showMenu();
} else {
	console.log("Invalid config for user " + config.username);
}

});