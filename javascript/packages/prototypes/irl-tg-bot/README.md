# Telegram Reminder Bot

A Telegram bot that helps you manage your reminders with daily and scheduled notifications.

## Features

- Add daily reminders
- Add one-time reminders with specific dates
- View daily reminders
- View monthly reminders
- Delete reminders
- Automatic notifications at 9:00, 15:00, and 21:00
- **Command menu panel in Telegram clients** (commands appear when you type `/`)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env.local` file with the following variables:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   TIMEZONE=UTC+3
   ```
4. Start the bot:
   ```bash
   npm start
   ```

The bot will automatically create a SQLite database file (`reminders.db`) in the project directory.

## Command Menu Panel

When you start a chat with your bot and type `/`, you will see a panel of available commands (like `/addreminder`, `/dailies`, etc.). This is set up automatically by the bot using the Telegram API, so you do not need to configure commands manually in BotFather.

## Bot Commands

- `/addreminder <text> [DD.MM.YYYY]` - Add a new reminder
  - Without date: Creates a daily reminder
  - With date: Creates a one-time reminder for the specified date

- `/dailies` - View all your daily reminders

- `/monthly` - View all your reminders for the current month

- `/deletereminder <id>` - Delete a reminder by its ID

## Examples

1. Add a daily reminder:
   ```
   /addreminder Take vitamins
   ```

2. Add a one-time reminder:
   ```
   /addreminder Doctor appointment 15.04.2024
   ```

3. View daily reminders:
   ```
   /dailies
   ```

4. View monthly reminders:
   ```
   /monthly
   ```

5. Delete a reminder:
   ```
   /deletereminder 1
   ```

## Development

For development with auto-reload:
```bash
npm run dev
``` 