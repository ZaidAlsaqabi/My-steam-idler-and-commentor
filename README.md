# Darkjoyless Steam Bot

A powerful Steam bot that combines game idling and group commenting capabilities with additional features like friend request handling and online status management.

## Features

### Core Features
- **Auto Group Commenter**: Automatically posts comments to Steam groups at configurable intervals
- **Game Idling**: Idle single or multiple games to earn cards and XP
- **Combined Operation**: Run both idling and commenting simultaneously

### Enhanced Features
- **Real-time Status Display**: Live updating status showing:
  - Idle time
  - Current game(s)
  - Online status
- **Friend Request Management**:
  - Auto-accept friend requests
  - Display Steam names of requesters
  - Timestamp logging
  - Telegram notifications
- **Online Status Control**:
  - Set status to Online or Invisible
  - Status applies to both idling and commenting sessions
- **Saved Games Configuration**:
  - Save favorite games for quick access
  - Support for single and multiple games
  - Game name display with AppIDs

### Anti-Spam Measures
- Configurable delays between group joins and comments
- Anti-spam checks before posting
- Rate limiting to prevent Steam restrictions

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/darkjoyless-steam-bot.git
cd darkjoyless-steam-bot
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

The bot can be configured through the interactive menu or by editing `config/config.json` directly.

### Menu Options
1. Auto Group Commenter
2. Idle Single Game
3. Idle Multiple Games
4. Run Both (Auto Comment + Idle)
5. Stop Idling (if active)
6. Configure Saved Games
7. Configure Friend Requests
8. Configure Online Status
9. Check Idle Status
10. Exit

### Key Features Configuration
- **Friend Requests**: Toggle auto-accept and view settings
- **Online Status**: Choose between Online and Invisible modes
- **Saved Games**: Save and manage favorite games for quick access
- **Group Commenting**: Set intervals and messages
- **Game Idling**: Configure single or multiple game idling

## Usage

1. Start the bot:
```bash
node bot.js
```

2. Use the menu to:
   - Start/stop features
   - Configure settings
   - Check status
   - Manage friend requests
   - Control online status

3. Press 'M' at any time to return to the main menu

## Status Display

The bot provides real-time status updates showing:
- Current idle time
- Active game(s)
- Online status

Status can be viewed:
- During normal operation
- Through the Check Idle Status option
- With live updates in both modes

## Telegram Integration

Configure Telegram notifications for:
- Friend request events
- Group commenting status
- Error alerts

## Security

- Steam Guard support
- Secure credential storage
- Rate limiting protection
- Anti-spam measures

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and feature requests, please use the GitHub issue tracker.

## Acknowledgments

- Steam Community API
- Node.js community
- All contributors and users