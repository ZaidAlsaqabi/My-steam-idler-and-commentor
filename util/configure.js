// SYNCHRONOUS CONFIGURATION SCRIPT FOR THE CONFIG/CONFIG.JSON FILE

var SteamCommunity = require('steamcommunity');
const ReadLine = require('readline');
const prompt = require('prompt-sync')({ sigint: true });
let configTemplate = require('../config/config.template.json');
const fs = require('fs');
const cheerio = require('cheerio');
const ConfigEncryption = require('./encrypt.js');

let community = new SteamCommunity();
var rl = ReadLine.createInterface({
	"input": process.stdin,
	"output": process.stdout
});

fs.readFile('./media/logo.txt', 'utf8', (err, data) => {
	if (err) {
		console.error(err);
		return;
	}
	console.log(data);
	console.log("Starting configuration script... Use CTRL + C to Quit at any time.\n");

	const steamUsername = prompt("Steam Username: ");
	const steamPassword = prompt("Steam Password: ");
	configTemplate.username = steamUsername;
	configTemplate.password = steamPassword;

	console.log("Authentication started...\n");
	run(steamUsername, steamPassword);
});

function parseGroupInput(raw) {
	if (!raw) {
		return [];
	}
	return raw.split(',')
		.map((entry) => {
			const trimmed = entry.trim();
			const match = trimmed.match(/steamcommunity\.com\/groups\/([^\/?#]+)/i);
			return match ? match[1] : trimmed.replace(/^\/+|\/+$/g, '');
		})
		.filter(Boolean);
}

function loadExistingConfigGroups() {
	try {
		const existing = JSON.parse(fs.readFileSync('./config/config.json', 'utf8'));
		return Array.isArray(existing.groups) ? existing.groups.filter(Boolean) : [];
	} catch (e) {
		return [];
	}
}

function parseGroupsHtml(body, found) {
	const $ = cheerio.load(body);
	$('a.linkTitle[href*="/groups/"]').each((_, el) => {
		const href = $(el).attr('href') || '';
		const match = href.match(/steamcommunity\.com\/groups\/([^\/?#]+)/i);
		if (match && match[1]) {
			found.set(match[1], ($(el).text() || '').trim() || match[1]);
		}
	});

	if (found.size === 0) {
		const re = /steamcommunity\.com\/groups\/([A-Za-z0-9_\-]+)/gi;
		let match;
		while ((match = re.exec(body)) !== null) {
			if (!found.has(match[1])) {
				found.set(match[1], match[1]);
			}
		}
	}
}

function fetchGroupsFromHtml(community, steamID, callback) {
	const sid = (steamID && steamID.getSteamID64) ? steamID.getSteamID64() : String(steamID || '');
	if (!sid) {
		callback(new Error('No SteamID available'), []);
		return;
	}

	const found = new Map();

	function fetchPage(page) {
		const url = 'https://steamcommunity.com/profiles/' + sid + '/groups/' + (page > 1 ? '?p=' + page : '');
		community.httpRequest(url, function (err, response, body) {
			if (err || !body) {
				const groups = Array.from(found.entries()).map(([url, name]) => ({ url, name }));
				callback(found.size ? null : (err || new Error('Empty groups page')), groups);
				return;
			}

			const before = found.size;
			parseGroupsHtml(body, found);

			if (found.size > before && page < 10) {
				fetchPage(page + 1);
				return;
			}

			callback(null, Array.from(found.entries()).map(([url, name]) => ({ url, name })));
		}, 'steamcommunity');
	}

	fetchPage(1);
}

function resolveGroupDetails(community, groupIds, done) {
	if (!groupIds.length) {
		done([], []);
		return;
	}

	const groups = [];
	const groupNames = [];
	let pending = groupIds.length;

	groupIds.forEach((gid) => {
		community.getSteamGroup(gid, function (err, group) {
			if (!err && group && group.url) {
				groups.push(group.url);
				groupNames.push(group.name || group.url);
			} else if (err) {
				console.log('Could not get steam group: ' + err);
			}
			pending--;
			if (pending === 0) {
				done(groups, groupNames);
			}
		});
	});
}

function ensureGroups(groups, groupNames, done) {
	if (groups.length > 0) {
		done(groups, groupNames);
		return;
	}

	console.log("\nCould not automatically load your Steam groups.");
	const existing = loadExistingConfigGroups();
	if (existing.length > 0) {
		const keep = prompt("Keep " + existing.length + " groups already in config.json? (y/n): ");
		if (keep === "y") {
			done(existing, existing.slice());
			return;
		}
	}

	const manual = prompt("Enter group URLs or names, comma-separated (e.g. iTraders, pcgamer): ");
	const parsed = parseGroupInput(manual);
	done(parsed, parsed.slice());
}

function promptRestOfConfig(groups, groupNames) {
	ensureGroups(groups, groupNames, function (groups, groupNames) {
		if (groups.length > 0) {
			const ignoreGroups = prompt("Ignore any Groups? (y/n): ");
			if (ignoreGroups == "y") {
				console.log("\nYou are in the following groups:");
				for (var i = 0; i < groups.length; i++) {
					console.log(`${i + 1}: ` + groups[i] + " (" + (groupNames[i] || groups[i]) + ")");
				}

				console.log("");
				const groupsToExclude = prompt("Please enter the indexes of groups that you would like to exclude, separated by commas (e.g. 3,23,52): ");
				let excludedGroups = groupsToExclude.split(",");

				const drop = new Set(excludedGroups.map((idx) => parseInt(idx, 10) - 1).filter((n) => !isNaN(n)));
				const keptGroups = [];
				const keptNames = [];
				const excludedUrls = [];
				const excludedNames = [];
				for (var i = 0; i < groups.length; i++) {
					if (!drop.has(i)) {
						keptGroups.push(groups[i]);
						keptNames.push(groupNames[i]);
					} else {
						excludedUrls.push(groups[i]);
						excludedNames.push(groupNames[i] || groups[i]);
					}
				}
				groups = keptGroups;
				groupNames = keptNames;
				configTemplate.groups_excluded = excludedUrls;
				configTemplate.group_names_excluded = excludedNames;

				console.log(`\nExcluding ${drop.size} groups.`);
				console.log(`Using the remaining ${groups.length} groups:`);
				for (var i = 0; i < groups.length; i++) {
					console.log("* " + groups[i] + " (" + (groupNames[i] || groups[i]) + ")");
				}
			}
		}

		configTemplate.groups = groups;
		configTemplate.group_names = groupNames;
		if (!Array.isArray(configTemplate.groups_excluded)) {
			configTemplate.groups_excluded = [];
		}
		if (!Array.isArray(configTemplate.group_names_excluded)) {
			configTemplate.group_names_excluded = [];
		}

		console.log("");
		const messageLocation = prompt("Use Pastebin or Local Text File for Message? (pastebin/local): ");
		if (messageLocation == "pastebin") {
			configTemplate.usePastebin = true;
			configTemplate.pastebinURL = prompt("Please enter the RAW URL of your pastebin containing the message: ");
		} else if (messageLocation == "local") {
			console.log("Using local text file for message.\nMake sure that your message is in a file called 'message.txt' in the /config directory.");
			configTemplate.usePastebin = false;
			configTemplate.pastebinURL = null;
		}

		console.log("");
		const useTelegram = prompt("Would you like to use Telegram notifications? (y/n): ");
		if (useTelegram == "y") {
			configTemplate.tg_bot_token = prompt("Please enter your Telegram bot token: ");
			configTemplate.tg_chat_id = prompt("Please enter your Telegram chat ID: ");
		} else {
			configTemplate.tg_bot_token = null;
			configTemplate.tg_chat_id = null;
		}

		console.log("");
		const autoAcceptFriends = prompt("Would you like to enable auto-accept friend requests? (y/n): ");
		if (autoAcceptFriends == "y") {
			configTemplate.features.auto_accept_friends = true;
			console.log("Auto-accept friend requests enabled!");
		} else {
			configTemplate.features.auto_accept_friends = false;
			console.log("Auto-accept friend requests disabled.");
		}

		console.log("");
		const useSavedGames = prompt("Would you like to configure saved games for idling? (y/n): ");
		if (useSavedGames == "y") {
			configTemplate.features.use_saved_games = true;
			const singleGame = prompt("Enter a single game ID to idle (e.g. 730 for CS2): ");
			configTemplate.saved_games.single_game = parseInt(singleGame);

			const multipleGames = prompt("Enter multiple game IDs separated by commas (e.g. 730, 440, 570): ");
			configTemplate.saved_games.multiple_games = multipleGames.split(',').map(id => parseInt(id.trim()));
			console.log("Saved games configured successfully!");
		} else {
			configTemplate.features.use_saved_games = false;
			console.log("Saved games feature disabled.");
		}

		console.log("");
		const configureFriendComment = prompt("Enable auto-comment on friends' profiles? (y/n): ");
		if (configureFriendComment == "y") {
			configTemplate.features.auto_friend_comment = true;
			const friendDelay = prompt("Set delay between friend comments in seconds (default 60): ");
			configTemplate.friend_post_delay = parseInt(friendDelay || 60);
			const excluded = prompt("Enter SteamID64s to exclude (comma-separated), or leave blank: ");
			configTemplate.friends_excluded = excluded.trim().length > 0 ? excluded.split(',').map(x => x.trim()) : [];
			console.log("\nFriend commenter uses message from ./config/friendcomment.txt if present, otherwise main message.");
		} else {
			configTemplate.features.auto_friend_comment = false;
		}

		console.log("");
		const advancedConfigure = prompt("Would you like to configure advanced options? (y/n): ");
		if (advancedConfigure == "y") {
			const interval = parseInt(prompt("Set interval (integer): "));
			const groupPostDelay = parseInt(prompt("Set group post delay (integer): "));
			const antiSpamCount = parseInt(prompt("Set anti-spam count (integer): "));

			console.log("Confirm Settings:\nInterval: " + interval + "\nGroup Post Delay: " + groupPostDelay + "\nAnti-Spam Count: " + antiSpamCount + "\n");
			const confirm = prompt("(y/n): ");
			if (confirm == "y") {
				configTemplate.interval = interval;
				configTemplate.group_post_delay = groupPostDelay;
				configTemplate.anti_spam_count = antiSpamCount;
			} else {
				console.log("Settings not confirmed, using default advanced options:\nInterval: " + configTemplate.interval + "\nGroup Post Delay: " + configTemplate.group_post_delay + "\nAnti-Spam Count: " + configTemplate.anti_spam_count);
			}
		}

		let tokenStatus = 'missing';
		try {
			const masterKey = process.env.CONFIG_MASTER_KEY;
			const encryption = new ConfigEncryption(masterKey);
			if (configTemplate.username && !encryption.isEncrypted(configTemplate.username)) {
				configTemplate.username = encryption.encrypt(configTemplate.username);
			}
			if (configTemplate.password && !encryption.isEncrypted(configTemplate.password)) {
				configTemplate.password = encryption.encrypt(configTemplate.password);
			}
			tokenStatus = encryption.encryptFileIfPlain('./config/steam-refresh.token');
		} catch (e) {
			console.log('Failed to encrypt credentials:', e.message);
			console.log('Aborting configuration without writing insecure credentials.');
			process.exit(1);
		}

		fs.writeFile('./config/config.json', JSON.stringify(configTemplate, null, 4), function (err) {
			if (err) {
				console.log(err);
			} else {
				console.log("\nConfiguration complete. Username and password are encrypted.");
				if (tokenStatus === 'encrypted') {
					console.log("Steam session token encrypted.");
				} else if (tokenStatus === 'already') {
					console.log("Steam session token is already encrypted.");
				} else {
					console.log("Steam session token will be encrypted automatically after the first login.");
				}
				console.log("Please restart the bot.");
				process.exit(0);
			}
		});
	});
}

function continueWithGroupList(xmlGroups, steamID) {
	if (xmlGroups.length > 0) {
		console.log("\nFetching " + xmlGroups.length + " Groups from profile XML\n");
		resolveGroupDetails(community, xmlGroups, promptRestOfConfig);
		return;
	}

	console.log("\nSteam profile XML did not include your groups (this is common now).");
	console.log("Trying your groups page instead...");
	fetchGroupsFromHtml(community, steamID, function (err, htmlGroups) {
		if (err) {
			console.log('Could not load groups page: ' + err);
		}
		if (htmlGroups && htmlGroups.length > 0) {
			console.log("Found " + htmlGroups.length + " group(s) on your groups page.\n");
			promptRestOfConfig(htmlGroups.map((g) => g.url), htmlGroups.map((g) => g.name));
			return;
		}
		promptRestOfConfig([], []);
	});
}

function run(accountName, password, authCode, twoFactorCode, captcha) {
	community.login({
		"accountName": accountName,
		"password": password,
		"authCode": authCode,
		"twoFactorCode": twoFactorCode,
		"captcha": captcha
	}, function (err, sessionID) {
		if (err) {
			if (err.message == 'SteamGuardMobile') {
				rl.question("Steam Authenticator Code: ", function (code) {
					run(accountName, password, null, code);
				});
				return;
			}

			if (err.message == 'SteamGuard') {
				console.log("An email has been sent to your address at " + err.emaildomain);
				rl.question("Steam Guard Code: ", function (code) {
					run(accountName, password, code);
				});
				return;
			}

			if (err.message == 'CAPTCHA') {
				console.log(err.captchaurl);
				rl.question("CAPTCHA: ", function (captchaInput) {
					run(accountName, password, authCode, twoFactorCode, captchaInput);
				});
				return;
			}

			if (String(err.message).includes('Invalid Steam Guard code') || String(err.message).includes('Invalid two-factor code') || String(err.message).includes('InvalidLoginAuthCode')) {
				console.log("\nIncorrect Steam Guard / authenticator code. Please try again.");
				rl.question("Steam Authenticator Code: ", function (code) {
					run(accountName, password, null, code);
				});
				return;
			}

			console.log(err);
			process.exit(1);
		}

		community.getSteamUser(community.steamID, function (err, user) {
			if (err) {
				console.log('Could not get steam user: ' + err);
				continueWithGroupList([], community.steamID);
				return;
			}

			const xmlGroups = (user && Array.isArray(user.groups)) ? user.groups : [];
			if (user && user.name) {
				console.log("\nLogged in as " + user.name);
			}
			continueWithGroupList(xmlGroups, community.steamID);
		});
	});
}
