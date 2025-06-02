const SteamCommunity = require('steamcommunity');
const ReadLine = require('readline');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require("node-fetch");
const SteamUser = require('steam-user');
var fs = require('fs');
var util = require('util');

try {
    config = require('./config/config.json');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('The config file does not exist. Please ensure you have a config/config.json file.');
        process.exit(1); // Exit with a failure code
    }
    throw error; // Re-throw the error if it's not a "module not found" error
}

// ------------------------------ MAIN ------------------------------ //

fs.readFile('./media/logo.txt', 'utf8', (err, data) => {
	if (err) {
	  console.error(err);
	  return;
	}
	console.log(data);

// SETUP FILE & STDOUT LOGGING
var logFile = fs.createWriteStream('log.txt', { flags: 'a' });
// Or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;
console.log = function () {
	logFile.write('> ' + new Date().toISOString() + ': ' + util.format.apply(null, arguments) + '\n');
	logStdout.write(util.format.apply(null, arguments) + '\n');
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

process.stdin.on('keypress', (str, key) => {
    if (key.name === 'm' || key.name === 'M') {
        console.log("\nReturning to menu...");
        showMenu();
    }
});

// Add new menu system
function showMenu() {
    console.log("\n=== Darkjoyless Steam Bot Menu ===");
    console.log("1. Auto Group Commenter");
    console.log("2. Idle Single Game");
    console.log("3. Idle Multiple Games");
    console.log("4. Run Both (Auto Comment + Idle)");
    console.log("5. Stop Idling (if active)");
    console.log("6. Configure Saved Games");
    console.log("7. Configure Friend Requests");
    console.log("8. Exit");
    console.log("\nPress 'M' at any time to return to this menu");
    
    rl.question("\nSelect an option (1-8): ", function(choice) {
        switch(choice) {
            case "1":
                config.features.auto_group_comment = true;
                config.features.idle_games = false;
                config.features.idle_multiple_games = false;
                startBot();
                break;
            case "2":
                config.features.auto_group_comment = false;
                config.features.idle_games = true;
                config.features.idle_multiple_games = false;
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
                config.features.auto_group_comment = false;
                config.features.idle_games = false;
                config.features.idle_multiple_games = true;
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
                config.features.auto_group_comment = true;
                config.features.idle_games = true;
                config.features.idle_multiple_games = true;
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
            case "5":
                stopIdling();
                break;
            case "6":
                configureSavedGames();
                break;
            case "7":
                configureFriendRequests();
                break;
            case "8":
                console.log("Exiting...");
                process.exit(0);
                break;
            default:
                console.log("Invalid option. Please try again.");
                showMenu();
        }
    });
}

function startBot() {
    if (config.username && config.password) {
	console.log("Starting authentication for " + config.username + "...");
	doLogin(config.username, config.password);
} else {
	console.log("Invalid config for user " + config.username);
}
}

// Add global variables for idling tracking
let steamUserInstance = null;
let isIdling = false;
let idleStartTime = null;
let idleTimer = null;
let gameNames = new Map(); // Store game names for display

// Add function to get game names from Steam API
async function getGameNames(appIds) {
    try {
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
    } catch (error) {
        console.log("Error in getGameNames:", error.message);
        // Set default names if API fails
        for (const appId of appIds) {
            gameNames.set(appId, `Game (${appId})`);
        }
    }
}

// Add function to display idle status
function displayIdleStatus() {
    if (!isIdling || !idleStartTime) return;

    const now = new Date();
    const diff = now - idleStartTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    // Clear the current line
    process.stdout.write('\r\x1b[K');
    
    // Display idle status
    let statusText = `Idling for: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} | Games: `;
    
    if (config.features.idle_multiple_games) {
        statusText += config.games_to_idle.map(id => gameNames.get(id) || `Game (${id})`).join(', ');
    } else {
        statusText += gameNames.get(config.games_to_idle[0]) || `Game (${config.games_to_idle[0]})`;
    }
    
    process.stdout.write(statusText);
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
            
            steamUserInstance.addFriend(steamID, (err) => {
                if (err) {
                    console.log(`Failed to accept friend request from ${userInfo.name} (${steamID}): ${err}`);
                    if (tgBot) {
                        tgBot.sendMessage(config.tg_chat_id, `Failed to accept friend request from ${userInfo.name} (${steamID}): ${err}`);
                    }
                } else {
                    console.log(`Accepted friend request from ${userInfo.name} (${steamID})`);
                    if (tgBot) {
                        tgBot.sendMessage(config.tg_chat_id, `Accepted friend request from ${userInfo.name} (${steamID})`);
                    }
                }
                if (callback) callback(err);
            });
        } catch (error) {
            console.log(`Error handling friend request from ${steamID}:`, error);
            if (callback) callback(error);
        }
    }
}

// Modify startIdling function's friend request handler
function startIdling(community) {
    if (isIdling) {
        console.log("Already idling games. Use option 5 to stop first.");
        return;
    }

    steamUserInstance = new SteamUser();
    isIdling = true;
    idleStartTime = new Date();
    
    // Get game names before starting idling
    getGameNames(config.games_to_idle).then(() => {
        steamUserInstance.logOn({
            accountName: config.username,
            password: config.password
        });

        steamUserInstance.on('loggedOn', () => {
            console.log("Logged into Steam for game idling");
            
            if (config.features.idle_multiple_games) {
                steamUserInstance.setPersona(SteamUser.EPersonaState.Online);
                steamUserInstance.gamesPlayed(config.games_to_idle);
                console.log(`Idling ${config.games_to_idle.length} games: ${config.games_to_idle.map(id => gameNames.get(id) || `Game (${id})`).join(', ')}`);
            } else if (config.features.idle_games) {
                steamUserInstance.setPersona(SteamUser.EPersonaState.Online);
                steamUserInstance.gamesPlayed(config.games_to_idle[0]);
                console.log(`Idling game: ${gameNames.get(config.games_to_idle[0]) || `Game (${config.games_to_idle[0]})`}`);
            }

            // Start the idle timer display
            console.log("\nIdle timer started. Press 'M' to return to menu.");
            idleTimer = setInterval(displayIdleStatus, 10000);
            displayIdleStatus(); // Initial display
        });

        // Add friend request handler
        steamUserInstance.on('friendRelationship', async (steamID, relationship) => {
            if (relationship === SteamUser.EFriendRelationship.RequestRecipient) {
                try {
                    const userInfo = await getUserProfileInfo(steamID);
                    console.log(`Received friend request from ${userInfo.name} (${steamID})`);
                    if (tgBot) {
                        tgBot.sendMessage(config.tg_chat_id, `Received friend request from ${userInfo.name} (${steamID})`);
                    }
                    handleFriendRequest(steamID);
                } catch (error) {
                    console.log(`Error processing friend request from ${steamID}:`, error);
                }
            }
        });

        steamUserInstance.on('error', (err) => {
            console.log("\nError during game idling:", err);
            isIdling = false;
            if (idleTimer) {
                clearInterval(idleTimer);
                idleTimer = null;
            }
        });

        steamUserInstance.on('loggedOff', () => {
            console.log("\nSteam session ended");
            isIdling = false;
            if (idleTimer) {
                clearInterval(idleTimer);
                idleTimer = null;
            }
        });
    });
}

// Modify stopIdling function
function stopIdling() {
    if (steamUserInstance && isIdling) {
        console.log("\nStopping game idling...");
        if (idleTimer) {
            clearInterval(idleTimer);
            idleTimer = null;
        }
        steamUserInstance.gamesPlayed([]); // Stop playing games
        steamUserInstance.logOff();
        steamUserInstance = null;
        isIdling = false;
        idleStartTime = null;
        console.log("Game idling stopped successfully.");
    } else {
        console.log("No active game idling session found.");
    }
    showMenu(); // Return to menu
}

// Modify the existing doLogin function to handle both features
function doLogin(accountName, password, authCode, twoFactorCode, captcha) {
	let community = new SteamCommunity();

	community.login({
		"accountName": accountName,
		"password": password,
		"authCode": authCode,
		"twoFactorCode": twoFactorCode,
		"captcha": captcha
	}, function (err) { // , sessionID, cookies, steamguard
		if (err) {
			if (err.message == 'SteamGuardMobile') {
				rl.question("Steam Authenticator Code: ", function (code) {
					doLogin(accountName, password, null, code);
				});

				return;
			}

			if (err.message == 'SteamGuard') {
				console.log("An email has been sent to your address at " + err.emaildomain);
				rl.question("Steam Guard Code: ", function (code) {
					doLogin(accountName, password, code);
				});

				return;
			}

			if (err.message == 'CAPTCHA') {
				console.log(err.captchaurl);
				rl.question("CAPTCHA: ", function (captchaInput) {
					doLogin(accountName, password, authCode, twoFactorCode, captchaInput);
				});

				return;
			}

			console.log(err);
			process.exit(1);
		}

		// console.log("Getting steam user...")
		community.getSteamUser(community.steamID, function (err, user) {
			if (err) {
				console.log('Could not get steam user: ' + err);
				process.exit(1);
			}
			console.log("Logged on as " + accountName + "...");

			// Start game idling if enabled
			if (config.features.idle_games || config.features.idle_multiple_games) {
				startIdling(community);
			}

			// JOIN UNLISTED GROUPS IF CONFIGURED
			if (config.join_unlisted_groups) {
				const userGroupIds = user.groups.map(g => g.getSteamID64());

				console.log("Checking unlisted groups... Est. time: " + ((config.group_post_delay * config.groups.length) / 60).toFixed(1) + " min");
				let itemsProcessed = 0;
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
			console.log("Starting group post interval...")

			try {
				run(community, config.interval, config.groups, config.message);
			} catch (e) {
					console.log("An error occurred in the run function: %j", e);
					if (tgBot) {
						tgBot.sendMessage(config.tg_chat_id, "Critical error occurred in the run function: %j" + String(e));
					}
				process.exit(1);
				}
			}

			// Add status message for combined features
			if (config.features.auto_group_comment && (config.features.idle_games || config.features.idle_multiple_games)) {
				console.log("\nRunning both features:");
				console.log("- Auto Group Commenter: Active");
				console.log("- Game Idling: Active");
				console.log("Use option 5 in the menu to stop idling at any time.");
			}
		});
	});
}


/**
 * Helper function for run - posts a comment to a single Steam group
 * @param {SteamCommunity} community - SteamCommunity instance for an authenticated user
 * @param {String} gid - Steam group ID
 * @param {String} message - Message to post
*/
function postGroupComment(community, gid, message) {
	community.getSteamGroup(gid, function (err, group) {
		if (err) {
			console.log(`Could not get steam group with gid ${gid}:`, err);
			tgBot.sendMessage(config.tg_chat_id, `Could not get steam group ${gid}: ${err}`);
			process.exit(1);
		}

		group.getAllComments(0, config.anti_spam_count, function (err, comments) {
			if (err) {
				console.log(`Could not get comments for group ${gid}:`, err);
				tgBot.sendMessage(config.tg_chat_id, `Could not get comments for group ${gid}: ${err}`);
				return;
			}
			if (comments.length > 0) {
				// Chcek if the authorId of any of the comments is the same as the bot's
				// If so, don't post the comment
				if (comments.some(c => c.authorId == community.steamID)) {
					console.log(`Anti-spam not satisfied in group '${gid}' - not posting comment`);
					return;
				}
			}

			if (config.usePastebin) {
				// Get message from pastebin
				fetch(config.pastebinURL).then(res => res.text()).then(message => {
					doComment(group, message);
				});
			} else {
				doComment(group, message);
			}
		});
	});
}
/**
 * Helper function to decrease code duplication in postGroupComment
 * @param {SteamGroup} group - SteamCommunity instance for an authenticated user
 * @param {String} message - Message to post
 */
function doComment(group, message) {
	group.comment(message, function (err) {
		if (err) {
			console.log(`Could not post comment to group ${gid}:`, err);
			tgBot.sendMessage(config.tg_chat_id, `Could not send message to steam group ${gid}: ${err}`);
			process.exit(1);
		}

		console.log("Comment posted on group: " + group.name + " at " + new Date().toLocaleString());
	});
}


/**
 * Post comments to an array of Steam groups on a specified interval
 * @param {SteamCommunity} community - SteamCommunity instance for an authenticated user
 * @param {Array} interval - Seconds between each series of posts
 * @param {Array} groups -  Array of Steam group IDs
 * @param {String} message - Message to post
 */
function run(community, interval, groups, message) {
	var i_id = 0;
	var interval = setInterval(function intervalFunc() {
		// Alert telegram that message was sent if tg_bot_token is set in config
		if (tgBot) {
			tgBot.sendMessage(config.tg_chat_id, "Posting to " + groups.length + " group(s) on interval " + i_id)
		}
		console.log("Posting to " + groups.length + " group(s) on interval " + i_id);

		groups.forEach((gid, i) => {
			// Add a delay of 5 seconds between each `postGroupComment`
			setTimeout(() => {
				postGroupComment(community, gid, message);
			}, (config.group_post_delay * i) * 1000);
		});
		i_id++;
		return intervalFunc;
	}(), interval * 1000);
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
        fs.writeFileSync('./config/config.json', JSON.stringify(config, null, 4));
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

// Modify the main execution to show menu first
if (config.username && config.password && config.groups.length > 0) {
	showMenu();
} else {
	console.log("Invalid config for user " + config.username);
}

});