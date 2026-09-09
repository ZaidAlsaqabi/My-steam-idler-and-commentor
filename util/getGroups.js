var SteamCommunity = require('steamcommunity');
var ReadLine = require('readline');

var SteamID = SteamCommunity.SteamID;
var community = new SteamCommunity();
var rl = ReadLine.createInterface({
    "input": process.stdin,
    "output": process.stdout
});

// 438989434389 = Me (steamcommunity.com/id/<your_id> - click on your profile and view the address bar)

rl.question("Steam User ID: ", function (userId) {
    var sid = new SteamID(userId);
    community.getSteamUser(sid, function (err, user) {
        if (err) {
            console.log('Could not get steam user: ' + err);
            process.exit(1);
        }

        const xmlGroups = (user && Array.isArray(user.groups)) ? user.groups : [];
        console.log("Fetching " + xmlGroups.length + " Groups for: " + user.name + "\n");

        var groups = new Array;
        var errors = 0;
        // Build an array of groups using for loop:
        console.log("User Groups:", xmlGroups);
        const userGroupIds = xmlGroups.map(group => group.getSteamID64());

        console.log("User Group IDS: ", userGroupIds)

        if (!xmlGroups.length) {
            console.log("Steam profile XML did not include groups for this user.");
            process.exit(0);
        }

        for (var i = 0; i < xmlGroups.length; i++) {
            community.getSteamGroup(xmlGroups[i], function (err, group) {
                if (err || !group) {
                    console.log('Could not get steam group: ' + err);
                    errors++;
                    if (groups.length == (xmlGroups.length - errors)) {
                        console.log(JSON.stringify(groups));
                    }
                    return;
                }
                groups.push(group.url);
                console.log("Group ID: " + group.url + " | Group Name: " + group.name + " | Group ID: " + group.steamID);
                console.log(userGroupIds.includes(String(group.steamID)))

                // When the array is full, print it out:
                if (groups.length == (xmlGroups.length - errors)) {
                    console.log(JSON.stringify(groups));
                }
            });
        } // End for loop

        // user.groups.forEach((groupId) => {
        //     community.getSteamGroup(groupId, function(err, group) {
        //         if (err) {
        //             console.log('Could not get steam group: ' + err);
        //             process.exit(1);
        //         }
        //         groups.push(group);
        //         console.log("Group ID: " + group.url + " | Group Name: " + group.name);
        //     });
        // }).then(() => { console.log(groups); });
    });
});