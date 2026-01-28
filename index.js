const { Client, GatewayIntentBits } = require('discord.js');
const { Client: NotionClient } = require('@notionhq/client');

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '2f6c2150cdb18087b6e1f93b856a1f56';

// Initialize clients
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const notion = new NotionClient({ auth: NOTION_TOKEN });

// Parse date string into ISO format (YYYY-MM-DD)
function parseDate(dateStr) {
  const now = new Date();
  const currentYear = now.getFullYear();

  // ISO format: 2026-02-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // MM/DD or M/D format: 2/15 or 02/15
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    return `${currentYear}-${month}-${day}`;
  }

  // Month name format: Feb 15, February 15
  const monthNames = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const monthMatch = dateStr.match(/^([a-z]+)\s+(\d{1,2})$/i);
  if (monthMatch) {
    const monthKey = monthMatch[1].toLowerCase();
    const month = monthNames[monthKey];
    if (month) {
      const day = monthMatch[2].padStart(2, '0');
      return `${currentYear}-${month}-${day}`;
    }
  }

  return null; // Invalid format
}

// Normalize status input to Notion status values
function normalizeStatus(input) {
  const statusMap = {
    'not started': 'Not started',
    'notstarted': 'Not started',
    'todo': 'Not started',
    'in progress': 'In progress',
    'inprogress': 'In progress',
    'doing': 'In progress',
    'done': 'Done',
    'complete': 'Done',
    'completed': 'Done',
  };
  return statusMap[input.toLowerCase()] || input;
}

// Parse command: !task [-high|-medium|-low] [-due DATE] [-status STATUS] [-id ID] Task description
function parseTaskCommand(content) {
  let remaining = content.slice(5).trim(); // Remove "!task"
  let priority = null;
  let dueDate = null;
  let status = null;
  let taskId = null;

  // Extract flags in any order
  let foundFlag = true;
  while (foundFlag) {
    foundFlag = false;

    // Check for priority flag
    const priorityMatch = remaining.match(/^-(high|medium|low)\s+/i);
    if (priorityMatch) {
      priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
      remaining = remaining.slice(priorityMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for due date flag
    const dueMatch = remaining.match(/^-due\s+(\S+(?:\s+\d{1,2})?)\s*/i);
    if (dueMatch) {
      const dateStr = dueMatch[1];
      dueDate = parseDate(dateStr);
      remaining = remaining.slice(dueMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for status flag (supports multi-word like "in progress")
    const statusMatch = remaining.match(/^-status\s+(not started|in progress|done|todo|doing|complete|completed|notstarted|inprogress)\s*/i);
    if (statusMatch) {
      status = normalizeStatus(statusMatch[1]);
      remaining = remaining.slice(statusMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for ID flag (for updating existing tasks)
    const idMatch = remaining.match(/^-id\s+(\d+)\s*/i);
    if (idMatch) {
      taskId = parseInt(idMatch[1], 10);
      remaining = remaining.slice(idMatch[0].length).trim();
      foundFlag = true;
      continue;
    }
  }

  return { taskName: remaining, priority, dueDate, status, taskId };
}

// Create task in Notion
async function createNotionTask(taskName, priority, dueDate, status) {
  const properties = {
    'Task name': {
      title: [{ text: { content: taskName } }],
    },
    'Status': {
      status: { name: status || 'Not started' },
    },
  };

  if (priority) {
    properties['Priority'] = {
      select: { name: priority },
    };
  }

  if (dueDate) {
    properties['Due date'] = {
      date: { start: dueDate },
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties,
  });

  return response;
}

// Find task by ID in Notion database
async function findTaskById(taskId) {
  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'ID',
      unique_id: {
        equals: taskId,
      },
    },
  });

  return response.results[0] || null;
}

// Update task status in Notion
async function updateTaskStatus(pageId, newStatus) {
  const response = await notion.pages.update({
    page_id: pageId,
    properties: {
      'Status': {
        status: { name: newStatus },
      },
    },
  });

  return response;
}

// Extract task ID from Notion page response
function getTaskId(page) {
  const idProp = page.properties['ID'];
  if (idProp && idProp.unique_id) {
    return idProp.unique_id.number;
  }
  return null;
}

// Extract task name from Notion page response
function getTaskName(page) {
  const titleProp = page.properties['Task name'];
  if (titleProp && titleProp.title && titleProp.title[0]) {
    return titleProp.title[0].plain_text;
  }
  return 'Unknown';
}

// Discord event handlers
discord.once('ready', () => {
  console.log(`✅ Bot is online as ${discord.user.tag}`);
});

discord.on('messageCreate', async (message) => {
  // Ignore bots and messages without prefix
  if (message.author.bot) return;
  if (!message.content.toLowerCase().startsWith('!task ')) return;

  const { taskName, priority, dueDate, status, taskId } = parseTaskCommand(message.content);

  try {
    // Update existing task by ID
    if (taskId !== null) {
      const existingTask = await findTaskById(taskId);
      if (!existingTask) {
        await message.reply(`❌ Task with ID **${taskId}** not found.`);
        return;
      }

      // Default to "Not started" if no status specified for updates
      const newStatus = status || 'Not started';
      await updateTaskStatus(existingTask.id, newStatus);
      const existingTaskName = getTaskName(existingTask);
      await message.reply(`✅ Task #${taskId} updated to **${newStatus}**: ${existingTaskName}\n<${existingTask.url}>`);
      return;
    }

    // Create new task
    if (!taskName) {
      await message.reply('❌ Please provide a task name.\n**Create:** `!task [-high|-medium|-low] [-due DATE] [-status STATUS] Your task`\n**Update:** `!task -id ID [-status STATUS]`\nDate formats: `2026-02-15`, `Feb 15`, `2/15`\nStatuses: `not started`, `in progress`, `done`');
      return;
    }

    const page = await createNotionTask(taskName, priority, dueDate, status);
    const newTaskId = getTaskId(page);
    const idText = newTaskId ? `#${newTaskId} ` : '';
    const priorityText = priority ? ` [${priority}]` : '';
    const dueText = dueDate ? ` (due: ${dueDate})` : '';
    const statusText = status ? ` → ${status}` : '';
    await message.reply(`✅ Task ${idText}created${priorityText}${dueText}${statusText}: **${taskName}**\n<${page.url}>`);
  } catch (error) {
    console.error('Error with task operation:', error);
    await message.reply('❌ Failed to process task. Check the bot logs.');
  }
});

// Start bot
discord.login(DISCORD_TOKEN);
