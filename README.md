# Steam Bot - Auto Group Commenter & Game Idler

A powerful Steam bot that combines auto group commenting and game idling capabilities. Perfect for managing your Steam presence and group engagement. Made by darkjoyless, this tool is ultimately optimized well-designed to handle multi tasks
and comments further feature are being added one being promising great with realtime updates will be adding auto message to direct messages, and auto friend add on future updates perhaps web control panel to manage the bot.

## Features

### Auto Group Commenter
- Automatically post comments to multiple Steam groups
- Configurable posting intervals
- Anti-spam protection
- Support for both local message files and Pastebin
- Soon a discord notification (Although working telegram configurer)
- Automatic group joining (optional)

### Game Idling
- Idle single or multiple games simultaneously
- Configurable status (Online, Away, Busy)
- Easy start/stop functionality
- Works alongside auto group commenting

### User Interface
- Interactive menu system
- Quick keyboard shortcuts
- Real-time status updates
- Easy configuration through setup script

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- A Steam account
- (Optional) Telegram bot token and chat ID for notifications

## Realtime secure steam login
-Feature backend to the steam login service
-Saves cookies for logining again for not to keep asking for steam
## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/steam-bot.git
cd steam-bot
```

2. Install dependencies:
```bash
npm install
```

3. Run the configuration script:
```bash
node util/configure.js
```

## Configuration

The bot uses a `config.json` file for settings. You can configure:

### Basic Settings
- `username`: Your Steam username
- `password`: Your Steam password
- `groups`: Array of Steam group IDs to post in
- `message`: Your comment message (or path to message.txt)

### Advanced Settings
- `interval`: Time between comment posts (in seconds)
- `group_post_delay`: Delay between posts to different groups
- `anti_spam_count`: Number of comments to check for anti-spam
- `join_unlisted_groups`: Whether to join groups automatically

### Telegram Integration
- `tg_bot_token`: Your Telegram bot token
- `tg_chat_id`: Your Telegram chat ID

### Game Idling
- `features.idle_games`: Enable single game idling
- `features.idle_multiple_games`: Enable multiple game idling
- `games_to_idle`: Array of game AppIDs to idle

## Usage

1. Start the bot:
```bash
node bot.js
```

2. Use the interactive menu:
```
=== Steam Bot Menu ===
1. Auto Group Commenter
2. Idle Single Game
3. Idle Multiple Games
4. Run Both (Auto Comment + Idle)
5. Stop Idling (if active)
6. Exit

Press 'M' at any time to return to this menu
```

### Keyboard Shortcuts
- `M`: Return to menu
- `Ctrl+C`: Interrupt current operation

### Running on VPS

1. Install Node.js on your VPS:
```bash
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Clone and setup the bot:
```bash
git clone https://github.com/yourusername/steam-bot.git
cd steam-bot
npm install
node util/configure.js
```

3. (Optional) Use PM2 to keep the bot running:
```bash
npm install -g pm2
pm2 start bot.js --name "steam-bot"
```

PM2 Commands:
- `pm2 status`: Check bot status
- `pm2 logs steam-bot`: View logs
- `pm2 restart steam-bot`: Restart bot
- `pm2 stop steam-bot`: Stop bot

## Security Notes

- Never share your `config.json` file
- Use environment variables for sensitive data
- Keep your Steam credentials secure
- Regularly update dependencies

## Troubleshooting

### Common Issues

1. **Steam Guard Required**
   - Enter the code when prompted
   - For mobile authenticator, use the code from your phone

2. **Rate Limiting**
   - Wait 30-60 minutes if you hit Steam's rate limits
   - Reduce posting frequency if needed

3. **Connection Issues**
   - Check your internet connection
   - Verify Steam servers are online
   - Check VPS firewall settings

### Logs

- Check `log.txt` for detailed operation logs
- Enable Telegram notifications for remote monitoring
- Use PM2 logs for VPS deployment

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and feature requests, please use the GitHub issue tracker.

## Acknowledgments

- Steam Community API
- Node.js community
- All contributors and users