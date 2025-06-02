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
- Real-time idling timer display (updates every 10 seconds)
- Automatic game name fetching from Steam API
- Configurable status (Online, Away, Busy)
- Easy start/stop functionality
- Works alongside auto group commenting

### User Interface
- Interactive menu system
- Quick keyboard shortcuts ('M' to return to menu)
- Real-time status updates
- Easy configuration through setup script
- Live game idling timer with game names

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
=== Darkjoyless Steam Bot Menu ===
1. Auto Group Commenter
2. Idle Single Game
3. Idle Multiple Games
4. Run Both (Auto Comment + Idle)
5. Stop Idling (if active)
6. Exit

Press 'M' at any time to return to this menu
```

### Game Idling Features
- Real-time timer display showing idling duration
- Automatic game name fetching from Steam API
- Support for single or multiple games
- Easy start/stop functionality
- Works alongside auto group commenting

### Keyboard Shortcuts
- `M`: Return to menu
- `Ctrl+C`: Interrupt current operation

### Running on VPS (Ubuntu)

1. Update system and install required packages:
```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

2. Install Node.js (v16.x):
```bash
# Remove any existing Node.js installation
sudo apt remove nodejs npm -y
sudo apt autoremove -y

# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -

# Install Node.js and npm
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

3. Install PM2 globally:
```bash
sudo npm install -g pm2
```

4. Clone and setup the bot:
```bash
# Clone the repository
git clone https://github.com/yourusername/steam-bot.git
cd steam-bot

# Install dependencies
npm install

# Create config directory and files
mkdir -p config
touch config/config.json
touch config/message.txt

# Set up the bot
node util/configure.js
```

5. Start the bot with PM2:
```bash
# Start the bot
pm2 start bot.js --name "steam-bot"

# Make PM2 start on system boot
pm2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
pm2 save
```

PM2 Commands:
```bash
# Check bot status
pm2 status

# View logs
pm2 logs steam-bot

# View real-time logs
pm2 logs steam-bot --lines 100 --raw

# Restart bot
pm2 restart steam-bot

# Stop bot
pm2 stop steam-bot

# Delete bot from PM2
pm2 delete steam-bot
```

6. (Optional) Set up automatic updates:
```bash
# Create update script
cat > update-bot.sh << 'EOF'
#!/bin/bash
cd /path/to/steam-bot
git pull
npm install
pm2 restart steam-bot
EOF

# Make it executable
chmod +x update-bot.sh

# Add to crontab (updates daily at 3 AM)
(crontab -l 2>/dev/null; echo "0 3 * * * /path/to/steam-bot/update-bot.sh") | crontab -
```

7. (Optional) Set up log rotation:
```bash
# Install logrotate if not installed
sudo apt install -y logrotate

# Create logrotate configuration
sudo nano /etc/logrotate.d/steam-bot

# Add the following configuration
/path/to/steam-bot/log.txt {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 $USER $USER
}
```

8. (Optional) Set up firewall rules:
```bash
# Allow SSH (if not already allowed)
sudo ufw allow ssh

# Allow outbound connections (required for Steam API)
sudo ufw allow out 80/tcp
sudo ufw allow out 443/tcp

# Enable firewall
sudo ufw enable
```

9. Monitor system resources:
```bash
# Install monitoring tools
sudo apt install -y htop

# Monitor system resources
htop

# Check disk space
df -h

# Check memory usage
free -h
```

10. Troubleshooting commands:
```bash
# Check bot logs
pm2 logs steam-bot

# Check system logs
journalctl -u pm2-$USER

# Check Node.js process
ps aux | grep node

# Check system resources
top

# Check network connections
netstat -tulpn | grep node
```

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

4. **Game Name Fetching**
   - If game names fail to fetch, the bot will use default names
   - Check your internet connection if names aren't loading
   - Steam API might be temporarily unavailable

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