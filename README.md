# Notion Task Bot for Discord

A simple Discord bot that creates tasks in your Notion database using the `!task` command.

## Usage

```
!task Buy groceries
!task -high Fix production bug
!task -medium Review PR
!task -low Update documentation
```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file with your tokens:
   ```
   DISCORD_TOKEN=your_discord_token
   NOTION_TOKEN=your_notion_token
   NOTION_DATABASE_ID=your_notion_database_id
   ```

3. Run the bot:
   ```bash
   npm start
   ```

## Deploy to Railway (Free Tier)

1. Push this folder to a GitHub repo

2. Go to [railway.app](https://railway.app) and sign in with GitHub

3. New Project → Deploy from GitHub repo

4. Add environment variables in Railway dashboard:
   - `DISCORD_TOKEN`
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`

5. Railway will auto-deploy and keep your bot running 24/7

## Deploy to Render (Free Tier)

1. Push to GitHub

2. Go to [render.com](https://render.com) → New → Background Worker

3. Connect your repo

4. Set environment variables

5. Deploy

**Note:** Free tier on Render spins down after inactivity. Railway is more reliable for always-on bots.

## Required Discord Bot Permissions

- Read Messages/View Channels
- Send Messages

## Required Notion Setup

Make sure your Notion integration is connected to the Tasks Tracker database:
1. Open the database in Notion
2. Click ••• menu → Connections
3. Add your integration
