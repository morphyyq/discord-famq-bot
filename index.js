require("dotenv").config();
process.env.LANG = "en_US.UTF-8";

const { MongoClient } = require("mongodb");
const express = require("express");

// Генерируем уникальный ID для этой запущенной копии бота
const INSTANCE_ID = Math.random().toString(36).substring(2, 7).toUpperCase();

const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    AttachmentBuilder,
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MessageFlags,
    PermissionFlagsBits,
    AuditLogEvent
} = require("discord.js");


// =====================================================
// KEEP ALIVE
// =====================================================
const app = express();

app.get("/", (_, res) => {
    res.send(`Bot Alive (Instance: ${INSTANCE_ID})`);
});

app.listen(process.env.PORT || 3000);


// =====================================================
// CLIENT
// =====================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [
        Partials.Channel,
        Partials.Message
    ]
});

client.on(Events.Error, (error) => {
    console.error(`[GLOBAL DISCORD ERROR] [${INSTANCE_ID}]`, error);
});


// =====================================================
// CONFIG
// =====================================================
const SERVERS = {
    "1458190222042075251": {
        CHANNELS: {
            SCREEN: "1499706104345792512",
            AUDIT: "1500501911848095906",
            SALARY: "1500515048970522685",
            PANEL: "1458410655697731730",
            CATEGORY: "1513659194832719962", 
            AUDIT_APP: "1464575195418460417",
            MONITOR: "1507787906700415076", 
            SBOR: "1458481307351781709",
            NOTIFY_PROMO: "1513660056338436206",
            REPORT_CATEGORY: "1458410646956806196",
            MAIN: "1503001219201761301",
            MAIN_CATEGORY: "1503001195919184023",
            RECRUIT: "1499701507619291206",
            RECRUIT_CATEGORY: "1499701418435809380",
            AUDIT_MAIN: "1503377972541915357",
            AUDIT_RECRUIT: "1507665992497496176",
            AFK: "1520898805103595772",
            LOG_FORUM: "1539978219380408440", // форум с логами Components V2
            PORTFOLIO_CATEGORY: "1521267379114344618" // категория для портфелей
        },
        ALLOWED_ROLES: [
            "1471553901433192532",
            "1458192704524648701",
            "1458192781217370173",
            "1468704257606684712" 
        ],
        ACADEMY_ROLES: [
            "1458410756453306490",
            "1507798049416675531",
            "1513647909965533377"
        ],
        CAPTURE_ROLES: [
            "1458410756453306490",
            "1475114013611528274"
        ],
        MAIN_ROLES: [
            "1475114013611528274"
        ],
        MONITOR_ROLES: [
            { id: ["1513647909965533377", "1458485405769797848", "1458485351424331903", "1458485277495656553"], name: "РП Состав" },
            { id: "1475114013611528274", name: "Каптеры" },
            { id: "1468704257606684712", name: "Рекруты" }
        ],
        PING_ROLES: [ 
            "1458410756453306490"
        ]
    },
    "1504470399268819115": {
        CHANNELS: {
            SBOR: "1504574610564321290" 
        },
        PING_ROLES: [ 
            "1504470450305241288", 
            "1505558808766971944"
        ]
    }
};


// =====================================================
// МП СИСТЕМА — МАДЖЕСТИК РП
// =====================================================
const MP_TYPES = {
    "Цеха":    { win: 15, lose: 7 },
    "Диллеры": { win: 15, lose: 7 },
    "Дроп":    { win: 20, lose: 10 },
    "Бизаки":  { win: 8,  lose: 3 },
    "Арена":   { win: 4,  lose: 0 },
    "Остров":  { win: 15, lose: 7 },
    "Тайники": { win: 5,  lose: 2 },
    "Капт":    { win: 20, lose: 10 }
};


// =====================================================
// МП ПОРОГИ ПОВЫШЕНИЯ РАНГОВ
// =====================================================
const MP_RANK_THRESHOLDS = [
    { points: 50,  from: "1513647909965533377", to: "1458485405769797848", label: "1 → 2 ранг" },
    { points: 100, from: "1458485405769797848", to: "1458485351424331903", label: "2 → 3 ранг" },
    { points: 150, from: "1458485351424331903", to: "1458485277495656553", label: "3 → 4 ранг" }
];

const MP_REVIEW_CHANNEL   = "1519416871328288798"; // канал модерации
const MP_REJECTED_CHANNEL = "1519417766380179658"; // канал отклонений

// =====================================================
// СИСТЕМА БАЛЛОВ ЗА ВРЕМЯ В ГОЛОСОВЫХ КАНАЛАХ
// =====================================================
const VOICE_POINTS_PER_MIN = 0.015;       // 0.015 балла/мин (1 балл = 66.7 мин)
const VOICE_AFK_CHANNEL_ID = "1458512575506550966"; // АФК войс — баллы не начисляются
const VOICE_TICK_MS = 60 * 1000;          // как часто "тикаем" начисление (раз в минуту)

// Канал, куда падает уведомление о покупке "Снять выговор"
const WARN_PURCHASE_CHANNEL = "1519416871328288798";

// userId -> { channelId, joinedAt } — текущая активная "учитываемая" сессия в войсе
const voiceSessions = new Map();

// Красивое отображение дробных баллов (1 знак после запятой, без хвоста .0)
function fmtPoints(value) {
    const num = Math.round((value || 0) * 10) / 10;
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

// =====================================================
// DATABASE (MONGODB)
// =====================================================
let db;
let salary = { balances: {}, recruits: {}, reports: {}, afk: {}, archive: {}, auditMessages: {}, mpPoints: {}, mpHistory: {}, portfolioHistory: {}, logThreads: {} };

async function connectDB() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db("darknessbot");
    console.log(`[DB] Подключено к MongoDB`);

    // Загружаем все данные из MongoDB в память при старте
    const docs = await db.collection("salary").find({}).toArray();
    for (const doc of docs) {
        if (doc._id === "balances") salary.balances = doc.data || {};
        else if (doc._id === "recruits") salary.recruits = doc.data || {};
        else if (doc._id === "reports") salary.reports = doc.data || {};
        else if (doc._id === "afk") salary.afk = doc.data || {};
        else if (doc._id === "archive") salary.archive = doc.data || {};
        else if (doc._id === "auditMessages") salary.auditMessages = doc.data || {};
        else if (doc._id === "mpPoints") salary.mpPoints = doc.data || {};
        else if (doc._id === "mpHistory") salary.mpHistory = doc.data || {};
        else if (doc._id === "portfolioHistory") salary.portfolioHistory = doc.data || {};
        else if (doc._id === "logThreads") salary.logThreads = doc.data || {};
    }
    console.log(`[DB] Данные загружены из MongoDB`);
}

async function saveDB(data) {
    // Сохраняем все секции параллельно
    await Promise.all([
        db.collection("salary").updateOne({ _id: "balances" }, { $set: { data: data.balances } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "recruits" }, { $set: { data: data.recruits } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "reports" }, { $set: { data: data.reports } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "afk" }, { $set: { data: data.afk } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "archive" }, { $set: { data: data.archive } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "auditMessages" }, { $set: { data: data.auditMessages } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "mpPoints" }, { $set: { data: data.mpPoints } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "mpHistory" }, { $set: { data: data.mpHistory } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "portfolioHistory" }, { $set: { data: data.portfolioHistory } }, { upsert: true }),
        db.collection("salary").updateOne({ _id: "logThreads" }, { $set: { data: data.logThreads } }, { upsert: true }),
    ]);
}


// =====================================================
// MEMORY & LOCKS
// =====================================================
const processed = new Set();
const applications = new Map();
const reportReviewLinks = new Map();
const reportReviewMeta = new Map();
const rpMenuInteractions = new Map();
const modalLocks = new Set();

// channelId -> userId — кто сейчас взял заявку на рассмотрение.
// Пока запись есть, другой рекрут не может нажать "Взять на рассмотрение".
const ticketReviewers = new Map();


// =====================================================
// ЗАЯВКИ — ТИКЕТ В ВИДЕ КОНТЕЙНЕРА (Components V2)
// =====================================================
const APP_TYPE_TITLES = {
    main: "Заявление — Main состав",
    recruit: "Заявление — Recruit",
    academy: "Заявление",
    capture: "Заявление"
};

const APP_STATUS_COLOR = {
    pending: 0x2b2d31,
    review: 0xF1C40F,
    call: 0xE67E22,
    accepted: 0x9B59B6,
    rejected: 0xE74C3C
};

// Текст анкеты по типу заявки (main / recruit / academy / capture)
function appAnswerBox(label, value) {
    let answer = String(value ?? "—").trim() || "—";
    // Не даём пользовательскому ответу закрыть markdown-кодовый блок.
    answer = answer.replace(/```/g, "''' ");
    if (answer.length > 1800) answer = `${answer.slice(0, 1797)}...`;
    return `**${label}**\n\`\`\`\n${answer}\n\`\`\``;
}

function buildAppBodyText(type, data) {
    if (!data) return "*Анкета не найдена в памяти бота (бот перезапускался).*";

    if (type === "main") {
        return [
            appAnswerBox("Ваш статик", data.q1),
            appAnswerBox("Предоставьте ваши откаты", data.q5)
        ].join("\n\n");
    }

    if (type === "recruit") {
        return [
            appAnswerBox("Ник и статик", data.q1),
            appAnswerBox("Имя и возраст (в реале)", data.q2),
            appAnswerBox("Почему хотите попасть в Recruit?", data.q3),
            appAnswerBox("Опыт в рекрутинге / похожих ролях", data.q4)
        ].join("\n\n");
    }

    const fields = [
        appAnswerBox("Ваш статический ID и ваш никнейм", data.q1),
        appAnswerBox("Имя и возраст (в реале)", data.q2),
        appAnswerBox("Есть ли опыт в семьях? Где состояли?", data.q3),
        appAnswerBox("Почему выбрали Darkness? Как узнали о нас?", data.q4)
    ];
    if (type !== "academy" && data.q5) {
        fields.push(appAnswerBox("Предоставьте свои откаты", data.q5));
    }
    return fields.join("\n\n");
}

function buildDirectApplicationAuditContainer({ status, data, type, targetId, username, channelId, actorId = null, reason = null }) {
    const statusConfig = {
        "Подана": { title: "📥 Заявка подана", color: 0x3498DB },
        "Рассмотрена": { title: "⏳ Заявка рассматривается", color: 0xF1C40F },
        "Принята": { title: "✅ Заявка принята", color: 0x2ECC71 },
        "Отказана": { title: "❌ Заявка отклонена", color: 0xE74C3C }
    }[status] || { title: "📋 Изменение заявки", color: 0x2B2D31 };

    const details = [
        `**Статус:** ${status}`,
        `**Тип заявки:** ${APP_TYPE_TITLES[type] || "Заявление"}`,
        `**Пользователь:** <@${targetId}>`,
        `**Username:** ${username || targetId}`,
        `**ID:** \`${targetId}\``,
        channelId ? `**Тикет:** <#${channelId}>` : "",
        actorId ? `**Кто изменил статус:** <@${actorId}>` : "",
        reason ? `**Причина отказа:** ${reason}` : ""
    ].filter(Boolean);

    return new ContainerBuilder()
        .setAccentColor(statusConfig.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${statusConfig.title}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details.join("\n")))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildAppBodyText(type, data)));
}

async function sendDirectApplicationAudit(guild, channelId, payload) {
    if (!guild || !channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    await channel.send({
        components: [buildDirectApplicationAuditContainer(payload)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    }).catch(() => null);
}

async function sendApplicationAudit(guild, { status, data, type, targetId, username, channelId, actorId = null, reason = null }) {
    const statusConfig = {
        "Подана": { title: "📥 Заявка подана", color: 0x3498DB },
        "Рассмотрена": { title: "⏳ Заявка рассмотрена", color: 0xF1C40F },
        "Принята": { title: "✅ Заявка принята", color: 0x2ECC71 },
        "Отказана": { title: "❌ Заявка отказана", color: 0xE74C3C }
    }[status] || { title: "📋 Изменение заявки", color: 0x2B2D31 };

    const lines = [
        `**Статус:** ${status}`,
        `**Тип заявки:** ${APP_TYPE_TITLES[type] || "Заявление"}`,
        `**Пользователь:** <@${targetId}> (${username || targetId})`,
        `**ID:** \`${targetId}\``,
        channelId ? `**Тикет:** <#${channelId}>` : "",
        actorId ? `**Кто изменил статус:** <@${actorId}>` : "",
        reason ? `**Причина отказа:** ${reason}` : "",
        "",
        buildAppBodyText(type, data)
    ].filter(Boolean);

    await sendForumLog(guild, "applicationAudit", lines, {
        title: statusConfig.title,
        color: statusConfig.color
    });
}

// Строка ряда с кнопками управления заявкой.
// Все кнопки сделаны нейтральными тёмно-серыми, чтобы не использовать яркие цвета.
function buildAppButtonsRow(targetId, { reviewTaken = false, reviewerTag = null, disableAll = false } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_accept_${targetId}`)
            .setLabel("Принять")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(`app_review_${targetId}`)
            .setLabel(reviewTaken ? `Рассматривает: ${reviewerTag}` : "Взять на рассмотрение")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll || reviewTaken),
        new ButtonBuilder()
            .setCustomId(`app_call_${targetId}`)
            .setLabel("Вызвать на обзвон")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(`app_reject_${targetId}`)
            .setLabel("Отклонить")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll)
    );
}

// Собирает контейнер тикета заявки целиком (используется и при создании, и при каждом обновлении статуса)
function buildAppContainer({ type, data, targetId, username, statusText, statusKey = "pending", reviewerId = null, buttonsRow = null }) {
    const title = APP_TYPE_TITLES[type] || "Заявление";
    const container = new ContainerBuilder().setAccentColor(APP_STATUS_COLOR[statusKey] || APP_STATUS_COLOR.pending);


    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📋 ${title}`));

    let statusLine = `**Статус:** ${statusText}`;
    if (reviewerId) statusLine += ` (<@${reviewerId}>)`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLine));

    if (reviewerId) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`👀 **Рассматривает:** <@${reviewerId}>`));
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildAppBodyText(type, data)));
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Пользователь:** <@${targetId}>\n**Username:** ${username}\n**ID:** ${targetId}`));

    if (buttonsRow) {
        container.addActionRowComponents(buttonsRow);
    }

    return container;
}

// Достаёт тип заявки по названию канала тикета (academy- / capture- / main- / recruit-)
function appTypeFromChannelName(name) {
    if (name.startsWith("main")) return "main";
    if (name.startsWith("recruit")) return "recruit";
    if (name.startsWith("academy")) return "academy";
    return "capture";
}

// Ищет ID кандидата в дереве компонентов сообщения-тикета (Components V2) по customId кнопки "app_accept_<id>"
function findAppTargetId(message) {
    function search(components) {
        if (!components) return null;
        for (const c of components) {
            if (c.customId && typeof c.customId === "string" && c.customId.startsWith("app_accept_")) {
                return c.customId.replace("app_accept_", "");
            }
            if (c.components) {
                const found = search(c.components);
                if (found) return found;
            }
        }
        return null;
    }
    return search(message.components);
}


// =====================================================
// SALARY EMBED SYSTEM
// =====================================================
async function updateSalaryEmbed(guild) {
    try {
        const config = SERVERS[guild.id];
        if (!config || !config.CHANNELS || !config.CHANNELS.SALARY) return;

        const channel = await guild.channels.fetch(config.CHANNELS.SALARY).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("💰 Ведомость выплат рекрут-состава")
            .setDescription("Актуальный баланс заработанных средств за принятых кандидатов.")
            .setColor("Green")
            .setTimestamp();

        let listString = "";
        let hasActiveBalances = false;

        for (const [recruiterId, bal] of Object.entries(salary.balances)) {
            if (bal > 0) {
                listString += `• <@${recruiterId}> — **$${bal.toLocaleString()}**\n`;
                hasActiveBalances = true;
            }
        }

        if (!hasActiveBalances) {
            listString = "*На этой неделе выплат пока нет.*";
        }

        embed.addFields({ name: "💵 Текущие балансы рекрутов:", value: listString, inline: false });

        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("💰 Ведомость выплат")) : null;

        if (botMessage) {
            await botMessage.edit({ embeds: [embed] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed] }).catch(() => null);
        }
    } catch (error) {
        console.error(`[SALARY EMBED ERROR]`, error);
    }
}


// =====================================================
// MONITORING SYSTEM
// =====================================================
async function updateOnlineMonitor() {
    try {
        for (const [guildId, config] of Object.entries(SERVERS)) {
            if (!config.CHANNELS || !config.CHANNELS.MONITOR) continue;

            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) continue;

            const channel = await guild.channels.fetch(config.CHANNELS.MONITOR).catch(() => null);
            if (!channel) continue;

            await guild.members.fetch();

            const embedsArray = [];
            let totalOnline = 0;
            let totalMembersCount = 0;

            const mainEmbed = new EmbedBuilder()
                .setTitle("📊 Мониторинг активного состава семьи")
                .setColor("#2b2d31")
                .setTimestamp();

            for (const roleData of config.MONITOR_ROLES) {
                let matchedMembers = [];
                
                if (Array.isArray(roleData.id)) {
                    roleData.id.forEach(id => {
                        const r = guild.roles.cache.get(id);
                        if (r) matchedMembers.push(...Array.from(r.members.values()));
                    });
                    matchedMembers = [...new Set(matchedMembers)];
                } else {
                    const role = guild.roles.cache.get(roleData.id);
                    if (role) matchedMembers = Array.from(role.members.values());
                }

                let listString = "";
                let roleOnline = 0;

                if (matchedMembers.length === 0) {
                    listString = "*В этой роли никого нет*";
                } else {
                    matchedMembers.forEach(member => {
                        totalMembersCount++;
                        const isOnline = member.presence && member.presence.status !== "offline";
                        const statusEmoji = isOnline ? "🟢" : "🔴";
                        
                        if (isOnline) {
                            roleOnline++;
                            totalOnline++;
                        }

                        listString += `<@${member.id}> — ${statusEmoji}\n`;
                    });
                }

                const roleEmbed = new EmbedBuilder()
                    .setTitle(`👥 ${roleData.name} [В сети: ${roleOnline}/${matchedMembers.length}]`)
                    .setDescription(listString)
                    .setColor("#2b2d31");

                embedsArray.push(roleEmbed);
            }

            mainEmbed.setDescription(`📈 **Общий онлайн выбранных ролей:** \`${totalOnline} из ${totalMembersCount}\``);
            embedsArray.unshift(mainEmbed);

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            const botMessage = messages ? messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.startsWith("📊 Мониторинг")) : null;

            if (botMessage) {
                await botMessage.edit({ embeds: embedsArray }).catch(() => null);
            } else {
                await channel.send({ embeds: embedsArray }).catch(() => null);
            }
        }
    } catch (error) {
        console.error(`[MONITOR ERROR] [${INSTANCE_ID}] Error updating monitor:`, error);
    }
}


// =====================================================
// FORUM AUDIT LOGS — отдельная публикация для каждого типа логов
// =====================================================
const LOG_THREAD_DEFS = {
    roleUpdate: {
        name: "👥 Изменение ролей",
        title: "🎭 Изменение ролей",
        color: 0x3498DB,
        description: "Логи выдачи и снятия ролей с участников."
    },
    memberJoinLeave: {
        name: "🚪 Входы и выходы",
        title: "🚪 Участник зашёл/вышел",
        color: 0x2ECC71,
        description: "Логи входа участников на сервер и выхода с сервера."
    },
    messageUpdate: {
        name: "📝 Изменение сообщений",
        title: "📝 Изменение сообщения",
        color: 0x3498DB,
        description: "Логи редактирования сообщений участников."
    },
    afkLeave: {
        name: "📌 Выход из AFK",
        title: "📌 Выход из AFK списка",
        color: 0xF1C40F,
        description: "Логи снятия статуса AFK из системы."
    },
    memberKick: {
        name: "🔨 Кики участников",
        title: "🔨 Участник кикнут",
        color: 0xE74C3C,
        description: "Логи принудительного исключения участников с сервера."
    },
    channelDelete: {
        name: "📡 Каналы",
        title: "📡 Изменение каналов",
        color: 0x3498DB,
        description: "Логи создания, удаления, переименования каналов и изменения прав."
    },
    applicationAudit: {
        name: "📋 Аудит заявок",
        title: "📋 Аудит заявки",
        color: 0x2B2D31,
        description: "Заявки семьи со статусами: подана, рассмотрена, принята или отказана."
    }
};

const logThreadLocks = new Map();

function clipLogText(value, max = 1800) {
    const text = String(value ?? "").trim();
    if (!text) return "—";
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildLogContainer({ title, color, lines, description = null }) {
    const container = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));

    if (description) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
    }

    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`🕒 Время: <t:${Math.floor(Date.now() / 1000)}:F>`));

    return container;
}

function logMessagePayload(def, lines, extra = {}) {
    return {
        components: [buildLogContainer({
            title: extra.title || def.title,
            color: extra.color || def.color,
            lines,
            description: extra.description || null
        })],
        flags: MessageFlags.IsComponentsV2,
        // В логах сохраняем красивые упоминания, но не создаём лишние пинги.
        allowedMentions: { parse: [] }
    };
}

async function findRecentAuditEntry(guild, type, targetId) {
    try {
        // Discord иногда публикует запись аудита с небольшой задержкой.
        await new Promise(resolve => setTimeout(resolve, 350));
        const audit = await guild.fetchAuditLogs({ type, limit: 10 });
        const now = Date.now();
        return audit.entries.find(entry => {
            const entryTargetId = entry.target?.id || entry.targetId;
            return entryTargetId === targetId && now - entry.createdTimestamp < 15000;
        }) || null;
    } catch (error) {
        console.error(`[AUDIT LOOKUP ERROR] [${INSTANCE_ID}]`, error.message || error);
        return null;
    }
}

async function ensureLogThread(guild, key) {
    const def = LOG_THREAD_DEFS[key];
    const forumId = SERVERS[guild?.id]?.CHANNELS?.LOG_FORUM;
    if (!def || !forumId) return null;

    const lockKey = `${guild.id}:${key}`;
    if (logThreadLocks.has(lockKey)) return logThreadLocks.get(lockKey);

    const promise = (async () => {
        try {
            const forum = await guild.channels.fetch(forumId).catch(() => null);
            if (!forum || forum.type !== ChannelType.GuildForum) {
                console.error(`[LOG FORUM] Канал ${forumId} не является форумом или недоступен.`);
                return null;
            }

            salary.logThreads ||= {};
            salary.logThreads[guild.id] ||= {};

            let thread = null;
            const savedId = salary.logThreads[guild.id][key];
            if (savedId) {
                thread = await forum.threads.fetch(savedId).catch(() => null);
            }

            if (!thread) {
                const active = await forum.threads.fetchActive().catch(() => null);
                thread = active?.threads?.find(t => t.name === def.name) || null;
            }

            if (!thread) {
                const archived = await forum.threads.fetchArchived({ limit: 100 }).catch(() => null);
                thread = archived?.threads?.find(t => t.name === def.name) || null;
            }

            if (thread && thread.name !== def.name) {
                await thread.setName(def.name).catch(() => null);
            }

            if (!thread) {
                thread = await forum.threads.create({
                    name: def.name,
                    autoArchiveDuration: 10080,
                    reason: "Создание публикации для логов бота",
                    message: logMessagePayload(def, [`📚 **Публикация логов создана автоматически.**`, def.description])
                });
            } else if (thread.archived) {
                await thread.setArchived(false).catch(() => null);
            }

            salary.logThreads[guild.id][key] = thread.id;
            await saveDB(salary);
            return thread;
        } catch (error) {
            console.error(`[LOG THREAD ERROR] ${key}`, error);
            return null;
        }
    })();

    logThreadLocks.set(lockKey, promise);
    try {
        return await promise;
    } finally {
        logThreadLocks.delete(lockKey);
    }
}

async function ensureAllLogThreads(guild) {
    if (!guild || !SERVERS[guild.id]?.CHANNELS?.LOG_FORUM) return;
    for (const key of Object.keys(LOG_THREAD_DEFS)) {
        await ensureLogThread(guild, key);
    }
}

async function sendForumLog(guild, key, lines, extra = {}) {
    try {
        if (!guild || !SERVERS[guild.id]?.CHANNELS?.LOG_FORUM) return;
        const def = LOG_THREAD_DEFS[key];
        const thread = await ensureLogThread(guild, key);
        if (!def || !thread) return;
        if (thread.archived) await thread.setArchived(false).catch(() => null);
        await thread.send(logMessagePayload(def, lines, extra));
    } catch (error) {
        console.error(`[FORUM LOG ERROR] ${key}`, error);
    }
}

function formatAuditExecutor(entry) {
    return entry?.executorId ? `<@${entry.executorId}>` : "Неизвестно / аудит недоступен";
}


// =====================================================
// AFK SYSTEM PANEL — Container (Components V2) со стилем как в игре
// =====================================================

async function updateAFKEmbed(guild) {
    try {
        const config = SERVERS[guild.id];
        const afkChannelId = config?.CHANNELS?.AFK || "1520898805103595772";
        const channel = await guild.channels.fetch(afkChannelId).catch(() => null);
        if (!channel) return;

        const AFK_BANNER_URL = "https://cdn.discordapp.com/attachments/1540014036081446922/1540289845220479016/ChatGPT_Image_21_._2026_._12_21_18.png?ex=6a896a34&is=6a8818b4&hm=387ec5f6b06641c1e530d2a67e9a51bfa4af8dafe6503bfe6b5e1e7de6f2b7b6&";
        const afkEntries = Object.entries(salary.afk);
        const total = afkEntries.length;

        // Формируем список участников в АФК как в игре: ник, причина, Вернусь в HH:MM:SS
        let listLines = "";
        afkEntries.forEach(([userId, data], idx) => {
            // data может быть строкой (старый формат) или объектом (новый)
            let reason = "афк";
            let returnTimestamp = null;
            let isVacation = false;

            if (typeof data === "object" && data !== null) {
                reason = data.reason || "афк";
                returnTimestamp = data.returnAt || null;
                isVacation = data.isVacation === true;
            } else {
                // старый формат — просто дата начала АФК
                returnTimestamp = null;
            }

            const returnStr = returnTimestamp
                ? `<t:${Math.floor(returnTimestamp / 1000)}:T>`
                : "—";

            const marker = isVacation ? "🏖️" : "💤";
            listLines += `**${idx + 1}) ${marker} <@${userId}>** Причина : \`${reason}\` Вернусь в : ${returnStr}\n`;
        });

        if (!listLines) listLines = "*В данный момент никто не находится в АФК режиме.*";

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("afk_enter").setLabel("Отошел АФК").setStyle(ButtonStyle.Secondary).setEmoji("💤"),
            new ButtonBuilder().setCustomId("afk_leave").setLabel("Вернулся из АФК").setStyle(ButtonStyle.Secondary).setEmoji("🟢")
        );

        const container = new ContainerBuilder()
            .setAccentColor(0x1a1a2e)
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(AFK_BANNER_URL)
                )
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ⏱ Люди, находящиеся в АФК\n**Всего в афк ${total} человек:**`)
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(listLines)
            )
            .addActionRowComponents(row);

        const payload = {
            components: [container],
            flags: MessageFlags.IsComponentsV2
        };

        const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        const botMessage = messages
            ? messages.find(m => m.author.id === client.user.id && (
                m.components.length > 0 ||
                (m.embeds.length > 0 && m.embeds[0].title?.includes("АФК"))
              ))
            : null;

        if (botMessage) {
            // Флаг IsComponentsV2 нельзя выставить редактированием старого embed-сообщения —
            // если апдейт не проходит, пересоздаём сообщение.
            const edited = await botMessage.edit(payload).catch(() => null);
            if (!edited) {
                await botMessage.delete().catch(() => null);
                await channel.send(payload).catch(() => null);
            }
        } else {
            await channel.send(payload).catch(() => null);
        }
    } catch (e) {
        console.error("[AFK EMBED UPDATE ERROR]", e);
    }
}


// =====================================================
// БАЛЛЫ ЗА ВРЕМЯ В ГОЛОСОВЫХ КАНАЛАХ
// =====================================================

// Канал считается "фармящим", если это не АФК-канал и в нём есть
// хотя бы один НЕ-бот участник (кроме самого проверяемого пользователя
// тоже не считается — должен быть кто-то живой рядом).
function isVoiceChannelEligible(channel, excludeUserId) {
    if (!channel) return false;
    if (channel.id === VOICE_AFK_CHANNEL_ID) return false;

    const humanMembers = channel.members.filter(
        m => !m.user.bot && m.id !== excludeUserId
    );
    return humanMembers.size > 0;
}

// Начисляет баллы за прошедшее время активной сессии и завершает её
function settleVoiceSession(userId) {
    const session = voiceSessions.get(userId);
    if (!session) return;

    const elapsedMs = Date.now() - session.joinedAt;
    voiceSessions.delete(userId);

    if (elapsedMs <= 0) return;

    const minutes = elapsedMs / 60000;
    const earned = minutes * VOICE_POINTS_PER_MIN;
    if (earned <= 0) return;

    salary.mpPoints[userId] = (salary.mpPoints[userId] || 0) + earned;
}

// Открывает новую "учитываемую" сессию для пользователя в канале
function startVoiceSession(userId, channelId) {
    voiceSessions.set(userId, { channelId, joinedAt: Date.now() });
}

// Пересчитывает, должна ли у пользователя сейчас идти сессия,
// и приводит voiceSessions в соответствие (используется при join/leave/move/mute и т.п.)
function reconcileVoiceState(member) {
    if (!member || member.user.bot) return;

    const voiceChannel = member.voice?.channel || null;
    const eligible = isVoiceChannelEligible(voiceChannel, member.id);
    const session = voiceSessions.get(member.id);

    if (eligible) {
        if (!session) {
            startVoiceSession(member.id, voiceChannel.id);
        } else if (session.channelId !== voiceChannel.id) {
            // сменил канал — закрываем старую сессию, открываем новую
            settleVoiceSession(member.id);
            startVoiceSession(member.id, voiceChannel.id);
        }
        // если сессия уже идёт в этом же канале — ничего не трогаем
    } else {
        if (session) settleVoiceSession(member.id);
    }
}

// При изменении состава канала (кто-то зашёл/вышел) нужно пересчитать
// ВСЕХ участников этого канала, т.к. условие "не один" могло измениться
function reconcileChannelMembers(channel) {
    if (!channel || !channel.members) return;
    channel.members.forEach(m => reconcileVoiceState(m));
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    try {
        const member = newState.member || oldState.member;
        if (!member) return;

        // Сам участник (бот игнорируется внутри reconcileVoiceState)
        reconcileVoiceState(member);

        // Если кто-то вышел/зашёл/перешёл — у соседей по каналу могло
        // поменяться условие "один в канале", пересчитываем и их
        if (oldState.channel && oldState.channel.id !== newState.channel?.id) {
            reconcileChannelMembers(oldState.channel);
        }
        if (newState.channel) {
            reconcileChannelMembers(newState.channel);
        }
    } catch (e) {
        console.error("[VOICE POINTS ERROR]", e);
    }
});

// Периодически "продлеваем" активные сессии — закрываем и сразу
// открываем заново, чтобы баллы сохранялись в БД, а не терялись при рестарте
async function tickVoicePoints() {
    try {
        if (voiceSessions.size === 0) return;

        const userIds = Array.from(voiceSessions.keys());
        for (const userId of userIds) {
            const session = voiceSessions.get(userId);
            if (!session) continue;
            settleVoiceSession(userId);
            startVoiceSession(userId, session.channelId);
        }
        await saveDB(salary);
    } catch (e) {
        console.error("[VOICE POINTS TICK ERROR]", e);
    }
}

// При старте бота подхватываем тех, кто уже сидит в войсе
async function initVoiceSessions(guild) {
    try {
        const channels = await guild.channels.fetch();
        channels.forEach(channel => {
            if (channel && channel.isVoiceBased && channel.isVoiceBased()) {
                reconcileChannelMembers(channel);
            }
        });
    } catch (e) {
        console.error("[VOICE POINTS INIT ERROR]", e);
    }
}


// =====================================================
// SYNC CROSS-SERVER JOIN ROLES
// =====================================================
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        if (member.guild.id === "1504470399268819115") {
            const darknessGuild = await client.guilds.fetch("1458190222042075251").catch(() => null);
            if (darknessGuild) {
                const isMemberOfDarkness = await darknessGuild.members.fetch(member.id).catch(() => null);
                if (isMemberOfDarkness) {
                    await member.roles.add("1504470450305241288").catch(() => null);
                }
            }
        }

        await sendForumLog(member.guild, "memberJoinLeave", [
            `**Пользователь:** <@${member.id}> (${clipLogText(member.user.tag)})`,
            `**ID:** \`${member.id}\``,
            `**Аккаунт создан:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`
        ], { title: "📥 Пользователь зашёл", color: 0x2ECC71 });

        if (member.roles.cache.has(PERSONAL_REPORT_ROLE_ID)) {
            await ensurePersonalReportChannel(member);
        }
    } catch (error) {
        console.error("[MEMBER ADD LOG ERROR]", error);
    }
});


// =====================================================
// READY & REGISTER COMMANDS
// =====================================================
client.once(Events.ClientReady, async () => {
    console.log(`[BOT] ONLINE: ${client.user.tag} | ID КОПИИ: ${INSTANCE_ID}`);

    const commands = [
        new SlashCommandBuilder()
            .setName("all")
            .setDescription("Разослать сообщение в ЛС всему составу")
            .addStringOption(opt => 
                opt.setName("message")
                .setDescription("Текст, который будет отправлен в ЛС")
                .setRequired(true)
            )
            .setDefaultMemberPermissions(0),
        
        // --- ОБНОВЛЕННАЯ КОМАНДА /panel ---
        new SlashCommandBuilder()
            .setName("panel")
            .setDescription("Отправить panel для подачи заявок")
            .addAttachmentOption(opt => 
                opt.setName("image")
                .setDescription("Прикрепите картинку для баннера панели")
                .setRequired(true)
            )
            .setDefaultMemberPermissions(0),

        new SlashCommandBuilder().setName("balance").setDescription("Посмотреть свой текущий баланс").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("group_panel").setDescription("Отправить panel управления сборами").setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("reset_salary")
            .setDescription("Полностью очистить все балансы игроков")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("deduct")
            .setDescription("Снять сумму с баланса рекрута")
            .addUserOption(opt =>
                opt.setName("user").setDescription("Рекрут").setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName("amount").setDescription("Сумма для списания (например 25000)").setRequired(true).setMinValue(1)
            )
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("add_salary")
            .setDescription("Добавить зарплату рекруту")
            .addUserOption(opt =>
                opt.setName("user").setDescription("Рекрут").setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName("amount").setDescription("Сумма для начисления (например 25000)").setRequired(true).setMinValue(1)
            )
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("report_panel").setDescription("Отправить широкую panel системы повышений").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("afk_panel").setDescription("Отправить panel ручного управления АФК статусом").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("afk_list").setDescription("Вызвать / обновить панель АФК списка в канале").setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("afk_kick")
            .setDescription("Кикнуть участника из АФК с причиной (отправит ЛС)")
            .addUserOption(opt => opt.setName("user").setDescription("Участник в АФК").setRequired(true))
            .addStringOption(opt => opt.setName("reason").setDescription("Причина кика из АФК").setRequired(true))
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("composition_panel").setDescription("Отправить ручную panel контроля состава").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("main_panel").setDescription("Отправить панель заявки в Main состав").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("recruit_panel").setDescription("Отправить панель заявки в отдел Recruit").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("rank").setDescription("Посмотреть статистику выполненных отчетов").addUserOption(opt => opt.setName("user").setDescription("Выбрать пользователя")).setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("info").setDescription("Получить личное дело и карточку заявки игрока").addUserOption(opt => opt.setName("user").setDescription("Выбрать пользователя").setRequired(true)).setDefaultMemberPermissions(0),

        // МП СИСТЕМА
        new SlashCommandBuilder().setName("mp_panel").setDescription("Отправить панель отчётов об МПшках").setDefaultMemberPermissions(0),
        new SlashCommandBuilder().setName("mp_points").setDescription("Посмотреть свои МП баллы").addUserOption(opt => opt.setName("user").setDescription("Посмотреть баллы другого игрока")),
        new SlashCommandBuilder().setName("mp_history").setDescription("Создать ветку с историей скринов игрока").addUserOption(opt => opt.setName("user").setDescription("Игрок").setRequired(true)).setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("mp_deduct")
            .setDescription("Снять МП баллы с игрока")
            .addUserOption(opt => opt.setName("user").setDescription("Игрок").setRequired(true))
            .addIntegerOption(opt => opt.setName("amount").setDescription("Кол-во баллов для снятия").setRequired(true).setMinValue(1))
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("add_points")
            .setDescription("Начислить МП баллы игроку")
            .addUserOption(opt => opt.setName("user").setDescription("Игрок").setRequired(true))
            .addIntegerOption(opt => opt.setName("amount").setDescription("Кол-во баллов для начисления").setRequired(true).setMinValue(1))
            .setDefaultMemberPermissions(0),

        // ПАНЕЛЬ ВЗАИМОДЕЙСТВИЯ
        new SlashCommandBuilder()
            .setName("interaction_panel")
            .setDescription("Отправить панель взаимодействия с функционалом бота")
            .setDefaultMemberPermissions(0),

        // ПАНЕЛЬ МАГАЗИНА
        new SlashCommandBuilder()
            .setName("shop_panel")
            .setDescription("Отправить панель семейного магазина баллов")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("portfolio_panel")
            .setDescription("Призвать админ-панель портфеля")
            .addUserOption(opt => opt
                .setName("user")
                .setDescription("Владелец портфеля")
                .setRequired(false))
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("clear_roles")
            .setDescription("Снять обычные роли со всех участников-людей")
            .setDefaultMemberPermissions(0),

        new SlashCommandBuilder()
            .setName("clear")
            .setDescription("Удалить сообщения в текущем канале")
            .addStringOption(opt =>
                opt.setName("amount")
                    .setDescription("Количество сообщений или all для полной очистки")
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("clear_stop")
            .setDescription("Остановить удаление сообщений")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("clear_roles_stop")
            .setDescription("Остановить снятие ролей")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("add_role_all")
            .setDescription("Выдать роль 1458410670071615580 всем участникам")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("add_role_all_stop")
            .setDescription("Остановить массовую выдачу роли")
            .setDefaultMemberPermissions(0),
        new SlashCommandBuilder()
            .setName("plus")
            .setDescription("Создать сбор плюсов на капт")
            .addStringOption(opt => opt.setName("name").setDescription("Название капта").setRequired(true))
            .addStringOption(opt => opt.setName("date").setDescription("Дата и время сбора").setRequired(true))
            .addIntegerOption(opt => opt.setName("slots").setDescription("Количество слотов").setRequired(true).setMinValue(1).setMaxValue(500))
            .setDefaultMemberPermissions(0)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        console.log(`[BOT] [${INSTANCE_ID}] Начало обновления слэш-команд...`);
        for (const guildId of Object.keys(SERVERS)) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
        }
        console.log(`[BOT] [${INSTANCE_ID}] Слэш-команды успешно зарегистрированы!`);
    } catch (e) {
        console.error(`[BOT ERROR] [${INSTANCE_ID}] Не удалось зарегистрировать команды:`, e);
    }

    const mainGuild = await client.guilds.fetch("1458190222042075251").catch(() => null);
    if (mainGuild) {
        await updateOnlineMonitor();
        await updateAFKEmbed(mainGuild);
        await ensureAllLogThreads(mainGuild);
        await ensurePersonalReportCategoryAccess(mainGuild);
        await migrateForumPortfoliosToChannels(mainGuild);
        await restoreLegacyPortfolioChannels(mainGuild);
        await removeLegacyPortfolioAdminChannels(mainGuild);
        await normalizePortfolioChannelNames(mainGuild);
        await initPersonalReportChannels(mainGuild);
        await syncAllPortfolioAdminThreads(mainGuild);
        await initVoiceSessions(mainGuild);
    }
    setInterval(updateOnlineMonitor, 60000);
    setInterval(tickVoicePoints, VOICE_TICK_MS);

    // =====================================================
    // ЕЖЕНЕДЕЛЬНЫЙ СБРОС ЗАРПЛАТ — каждое воскресенье в 20:00 МСК
    // =====================================================
    setInterval(async () => {
        const now = new Date();
        // МСК = UTC+3
        const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
        const isSunday  = msk.getUTCDay()    === 0;
        const isHour    = msk.getUTCHours()  === 20;
        const isMinute  = msk.getUTCMinutes() === 0;
        if (!isSunday || !isHour || !isMinute) return;

        try {
            const guild = await client.guilds.fetch("1458190222042075251").catch(() => null);
            if (!guild) return;

            const auditChannel = await guild.channels.fetch("1500501911848095906").catch(() => null);
            if (!auditChannel) return;

            // Формируем итоговую таблицу
            let list = "";
            let total = 0;
            for (const [recruiterId, bal] of Object.entries(salary.balances)) {
                if (bal > 0) {
                    list += `• <@${recruiterId}> — **$${bal.toLocaleString()}**\n`;
                    total += bal;
                }
            }
            if (!list) list = "*На этой неделе выплат не было.*";

            const reportEmbed = new EmbedBuilder()
                .setTitle("📋 Еженедельная ведомость зарплат рекрут-состава")
                .setDescription(`Итоговый отчёт за неделю. После этого сообщения балансы сброшены.\n\n${list}`)
                .addFields({ name: "💵 Итого к выплате:", value: `**$${total.toLocaleString()}**`, inline: false })
                .setColor("Gold")
                .setTimestamp();

            await auditChannel.send({ embeds: [reportEmbed] }).catch(() => null);

            // Сбрасываем балансы и привязки
            salary.balances = {};
            salary.recruits = {};
            salary.auditMessages = {};
            await saveDB(salary);

            // Обновляем embed зарплат
            await updateSalaryEmbed(guild);

            console.log(`[WEEKLY RESET] Зарплаты сброшены в воскресенье.`);
        } catch (e) {
            console.error("[WEEKLY RESET ERROR]", e);
        }
    }, 60000); // проверяем каждую минуту
});


// =====================================================
// GUILD MEMBER REMOVE
// =====================================================
client.on(Events.GuildMemberRemove, async (member) => {
    try {
        await notifyPersonalReportRoleLost(member.guild, member.id, "leave");
        const kickEntry = await findRecentAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
        const memberLogLines = [
            `**Участник:** <@${member.id}> (${clipLogText(member.user?.tag || member.displayName)})`,
            `**ID:** \`${member.id}\``,
            `**Роли до выхода:** ${member.roles?.cache?.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(", ") || "нет ролей"}`
        ];

        if (kickEntry) {
            await sendForumLog(member.guild, "memberKick", [
                ...memberLogLines,
                `**Кто кикнул:** ${formatAuditExecutor(kickEntry)}`,
                `**Причина:** ${clipLogText(kickEntry.reason || "Причина не указана")}`
            ]);
        } else {
            await sendForumLog(member.guild, "memberJoinLeave", memberLogLines, {
                title: "📤 Участник покинул сервер",
                color: 0xE74C3C
            });
        }

        if (salary.afk && salary.afk[member.id]) {
            const afkData = salary.afk[member.id];
            await sendForumLog(member.guild, "afkLeave", [
                `**Участник:** <@${member.id}>`,
                `**Причина AFK:** ${clipLogText(afkData?.reason || "афк")}`,
                `**Снял статус:** Система (участник покинул сервер)`
            ]);
            delete salary.afk[member.id];
            await saveDB(salary);
            await updateAFKEmbed(member.guild);
        }

        if (salary.recruits && salary.recruits[member.id]) {
            const recruiterId = salary.recruits[member.id];

            // Если у участника перед выходом осталась только одна роль (DEDUCT_ROLE_ID),
            // значит GuildMemberUpdate уже списал $25,000 — не списываем второй раз
            const rolesWithoutEveryone = member.roles.cache.filter(r => r.id !== member.guild.id);
            const alreadyDeducted = rolesWithoutEveryone.size === 1 && rolesWithoutEveryone.has(DEDUCT_ROLE_ID);

            if (!alreadyDeducted) {
                if (salary.balances[recruiterId]) {
                    salary.balances[recruiterId] -= 25000;
                    if (salary.balances[recruiterId] < 0) salary.balances[recruiterId] = 0;
                }
            }

            if (salary.auditMessages && salary.auditMessages[member.id]) {
                const config = SERVERS[member.guild.id];
                if (config && config.CHANNELS && config.CHANNELS.AUDIT) {
                    const auditChannel = await member.guild.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
                    if (auditChannel) {
                        const auditMsgId = salary.auditMessages[member.id];
                        const auditMsg = await auditChannel.messages.fetch(auditMsgId).catch(() => null);
                        
                        if (auditMsg) {
                            const reaction = auditMsg.reactions.cache.find(r => r.emoji.name === "✅");
                            if (reaction) {
                                await reaction.users.remove(client.user.id).catch(() => null);
                            }
                            await auditMsg.react("❌").catch(() => null);
                        }
                    }
                }
                delete salary.auditMessages[member.id];
            }

            delete salary.recruits[member.id];
            await saveDB(salary);
            await updateSalaryEmbed(member.guild);

            // Уведомление только если списание произошло именно здесь (не было раньше через MemberUpdate)
            if (!alreadyDeducted) {
                const newBal = salary.balances[recruiterId] || 0;
                const notifyChannel = await member.guild.channels.fetch("1518544382985371698").catch(() => null);
                if (notifyChannel) {
                    await notifyChannel.send({
                        content: `⚠️ <@${recruiterId}>, с вашего баланса списано **$25,000** — <@${member.id}> **вышел с сервера**.\nВаш баланс: **$${newBal.toLocaleString()}**`
                    }).catch(() => null);
                }
            }
        }
    } catch (e) {
        console.error("[ERROR AT MEMBER REMOVE]", e);
    }
});


// =====================================================
// MESSAGE SYSTEM
// =====================================================
async function downloadReportImage(url, fileName) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        return new AttachmentBuilder(buffer, { name: fileName });
    } catch (error) {
        console.error("[REPORT IMAGE DOWNLOAD ERROR]", error.message || error);
        return null;
    }
}

function buildReportReviewContainer({ userId, title, details, color = 0x3498DB, evidenceUrl = null, attachmentName = null, buttons = null }) {
    const container = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details));

    // Картинку вставляем в тот же контейнер: файл летит вложением этого же сообщения.
    const galleryUrl = attachmentName
        ? `attachment://${attachmentName}`
        : (evidenceUrl && /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(evidenceUrl) ? evidenceUrl : null);

    if (galleryUrl) {
        container
            .addSeparatorComponents(new SeparatorBuilder())
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(galleryUrl)
                )
            );
    }

    if (buttons) container.addActionRowComponents(buttons);
    return container;
}

function scheduleEphemeralDelete(interaction, delay = 120000) {
    setTimeout(() => interaction.deleteReply().catch(() => null), delay);
}

async function deleteRpMenu(userId) {
    const menuInteraction = rpMenuInteractions.get(userId);
    if (!menuInteraction) return;
    rpMenuInteractions.delete(userId);
    await menuInteraction.deleteReply().catch(() => null);
}

async function sendPortfolioReportStatus(guild, userId, { status, type, details, evidenceUrl = null }) {
    const portfolioChannel = await findPersonalReportChannel(guild, userId, true);
    if (!portfolioChannel) {
        console.warn(`[PORTFOLIO REPORT] Ролевой личный канал не найден для ${userId}`);
        return;
    }

    const colors = {
        "Принят": 0x2ECC71,
        "Отклонён": 0xE74C3C
    };
    const evidenceFileName = "evidence.png";
    const evidenceFile = evidenceUrl && /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(evidenceUrl)
        ? await downloadReportImage(evidenceUrl, evidenceFileName)
        : null;

    const container = buildReportReviewContainer({
        userId,
        title: `<@${userId}>`,
        details: `**Статус:** ${status}\n**Тип:** ${type}\n${details}${evidenceUrl ? `\n**Доказательство:** ${evidenceUrl}` : ""}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        color: colors[status] || 0x2B2D31,
        evidenceUrl,
        attachmentName: evidenceFile ? evidenceFileName : null
    });

    const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
    if (evidenceFile) payload.files = [evidenceFile];

    await portfolioChannel.send(payload).catch(error => console.error("[PORTFOLIO REPORT ERROR]", error));
}

client.on(Events.MessageCreate, async (msg) => {
    try {
        if (!msg.guild || msg.author.bot) return;

        const config = SERVERS[msg.guild.id];
        if (!config) return;

        // =====================================================
        // МП СКРИН — ожидание скриншота от игрока
        // =====================================================
        // =====================================================
        // РП ОТЧЁТ — ожидание скриншота от игрока
        // =====================================================
        const awaitRpKey = `rp_await_${msg.author.id}`;
        if (applications.has(awaitRpKey)) {
            const att = msg.attachments.find(a =>
                a.contentType?.startsWith("image") ||
                /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(a.name || a.url || "")
            ) || msg.attachments.first();
            const evidenceLink = msg.content?.match(/https?:\/\/\S+/i)?.[0] || null;
            if (!att && !evidenceLink) return; // принимаем фото или ссылку

            const rpData = applications.get(awaitRpKey);
            await rpData.deletePrompt?.();
            await rpData.deleteMenu?.();
            applications.delete(awaitRpKey);

            const rpChannel = await client.channels.fetch(rpData.channelId).catch(() => null);
            if (rpChannel) {
                await rpChannel.permissionOverwrites.delete(msg.author.id).catch(() => null);
            }

            const reviewChannel = await client.channels.fetch(MP_REVIEW_CHANNEL).catch(() => null);
            if (!reviewChannel) return;

            const rpName = rpData.rpName || rpData.label;
            const fileName = "rp_screen.png";
            const file = att ? await downloadReportImage(att.url, fileName) : null;
            const evidenceUrl = att?.url || evidenceLink || null;

            const encodedName = Buffer.from(rpName).toString("base64").replace(/=/g, "");
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rp_accept_${rpData.subType}_${msg.author.id}_${rpData.points}_${encodedName}`)
                    .setLabel("✅ Одобрить")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`rp_reject_${msg.author.id}`)
                    .setLabel("❌ Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            const container = buildReportReviewContainer({
                userId: msg.author.id,
                title: `<@${msg.author.id}>`,
                details: `**Статус:** На проверке\n**Тип:** ${rpData.label}\n**Название:** ${rpName}\n**Баллов при одобрении:** +${rpData.points}\n**Доказательство:** ${evidenceLink || "прикреплено изображением"}`,
                color: 0x3498DB,
                evidenceUrl,
                attachmentName: file ? fileName : null,
                buttons: row
            });
            const payload = { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
            if (file) payload.files = [file];
            const reviewMessage = await reviewChannel.send(payload);
            if (reviewMessage) reportReviewMeta.set(reviewMessage.id, { evidenceUrl: att?.url || evidenceLink, type: rpData.label });
            setTimeout(() => msg.delete().catch(() => null), 8000);
            return;
        }

        const awaitKey = `mp_await_${msg.author.id}`;
        if (applications.has(awaitKey)) {
            const att = msg.attachments.find(a =>
                a.contentType?.startsWith("image") ||
                /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(a.name || a.url || "")
            ) || msg.attachments.first();
            const evidenceLink = msg.content?.match(/https?:\/\/\S+/i)?.[0] || null;
            if (!att && !evidenceLink) return; // принимаем фото или ссылку

            const mpData = applications.get(awaitKey);
            applications.delete(awaitKey);

            const mpScreenChannel = await client.channels.fetch(mpData.channelId).catch(() => null);
            if (mpScreenChannel) {
                await mpScreenChannel.permissionOverwrites.delete(msg.author.id).catch(() => null);
            }

            const reviewChannel = await client.channels.fetch(MP_REVIEW_CHANNEL).catch(() => null);
            if (!reviewChannel) return;

            const fileName = "mp_screen.png";
            const file = att ? await downloadReportImage(att.url, fileName) : null;
            const evidenceUrl = att?.url || evidenceLink || null;
            const safeId = `${msg.author.id}_${mpData.mpType.replace(/ /g, "")}_${mpData.result}_${mpData.points}_${mpData.channelId}`;
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`mp_accept_${safeId}`)
                    .setLabel("✅ Принять")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`mp_reject_${safeId}`)
                    .setLabel("❌ Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            const container = buildReportReviewContainer({
                userId: msg.author.id,
                title: `<@${msg.author.id}>`,
                details: `**Статус:** На проверке\n**Тип:** МП отчёт\n**МПшка:** ${mpData.mpType}\n**Результат:** ${mpData.result === "win" ? "Win" : "Lose"}\n**Баллов к начислению:** +${mpData.points}\n**Доказательство:** ${evidenceLink || "прикреплено изображением"}`,
                color: mpData.result === "win" ? 0x3498DB : 0xF39C12,
                evidenceUrl,
                attachmentName: file ? fileName : null,
                buttons: row
            });
            const payload = { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
            if (file) payload.files = [file];
            const reviewMessage = await reviewChannel.send(payload);
            if (reviewMessage) reportReviewMeta.set(reviewMessage.id, { evidenceUrl: att?.url || evidenceLink, type: "МП отчёт" });
            setTimeout(() => msg.delete().catch(() => null), 8000);
            return;
        }

        if (msg.content === "/balance") {
            const currentBal = salary.balances[msg.author.id] || 0;
            return msg.reply({
                content: `💰 Баланс: $${currentBal.toLocaleString()}`
            });
        }

        if (msg.channel.name?.startsWith("closed-")) {
            const att = msg.attachments.find(a =>
                a.contentType?.startsWith("image") ||
                /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(a.name || a.url || "")
            ) || msg.attachments.first();
            if (!att) return;

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => msg.member.roles.cache.has(role));
            if (!hasPermission) return;

            const channelMessages = await msg.channel.messages.fetch({ limit: 50 }).catch(() => null);
            let candidateText = "Не удалось определить";
            let candidateId = "unknown";

            if (channelMessages) {
                const appMessage = channelMessages.find(m => m.author.id === client.user.id && m.flags?.has(MessageFlags.IsComponentsV2));
                if (appMessage) {
                    const foundId = findAppTargetId(appMessage);
                    if (foundId) {
                        candidateId = foundId;
                        candidateText = `<@${candidateId}>`;
                    }
                }
            }

            const auditChannel = await client.channels.fetch(config.CHANNELS.AUDIT).catch(() => null);
            if (auditChannel) {
                const file = new AttachmentBuilder(att.url, { name: "screen.png" });
                
                const auditMsg = await auditChannel.send({ 
                    content: `📋 **Отчёт по принятой заявке**\n👤 **Рекрутер:** <@${msg.author.id}>\n👤 **Принятый кандидат:** ${candidateText}\n📂 **Тикет:** \`${msg.channel.name}\``,
                    files: [file] 
                });

                await auditMsg.react("✅").catch(() => null);

                salary.balances[msg.author.id] = (salary.balances[msg.author.id] || 0) + 25000;
                
                if (candidateId && candidateId !== "unknown") {
                    salary.recruits[candidateId] = msg.author.id;
                    salary.auditMessages[candidateId] = auditMsg.id; 
                }

                await saveDB(salary);
                await updateSalaryEmbed(msg.guild);
            }

            await msg.channel.send("✅ Отчёт успешно зафиксирован в аудите! Тикет удаляется...");
            setTimeout(() => msg.channel.delete().catch(() => null), 3000);
            
            setTimeout(updateOnlineMonitor, 4000);
            return;
        }

        if (config.CHANNELS && msg.channel.id === config.CHANNELS.SCREEN) {
            if (processed.has(msg.id)) return;
            processed.add(msg.id);
            setTimeout(() => { processed.delete(msg.id); }, 120000);

            const att = msg.attachments.find(a =>
                a.contentType?.startsWith("image") ||
                /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(a.name || a.url || "")
            ) || msg.attachments.first();
            if (!att) return;

            const audit = await client.channels.fetch(config.CHANNELS.AUDIT);
            if (!audit) return;

            const file = new AttachmentBuilder(att.url, { name: "screen.png" });

            const embed = new EmbedBuilder()
                .setTitle("📸 Новый отчёт")
                .setDescription(`👤 Рекрут: <@${msg.author.id}>`)
                .setImage(`attachment://screen.png`)
                .setColor("Blue")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${msg.author.id}`)
                    .setLabel("Принять")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reject_${msg.author.id}`)
                    .setLabel("Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            await audit.send({
                embeds: [embed],
                files: [file],
                components: [row]
            });

            setTimeout(async () => {
                try { await msg.delete(); } catch {}
            }, 10000);
        }

    } catch (e) {
        console.log(`[MESSAGE ERROR] [${INSTANCE_ID}]`, e);
    }
});


// =====================================================
// MESSAGE UPDATE — логирование редактирования сообщений
// =====================================================
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
        if (!newMessage.guild || newMessage.author?.bot) return;
        if (oldMessage.partial) await oldMessage.fetch().catch(() => null);

        const before = oldMessage.content || "[Текст неизвестен, сообщение не было в кеше бота]";
        const after = newMessage.content || "[сообщение без текста / текст удалён]";
        if (before === after) return;

        const imageAttachment = newMessage.attachments?.find(a => a.contentType?.startsWith("image/"));
        await sendForumLog(newMessage.guild, "messageUpdate", [
            `**Автор:** <@${newMessage.author.id}> (${clipLogText(newMessage.author.tag)})`,
            `**Канал:** <#${newMessage.channelId}>`,
            `**Сообщение:** [перейти](https://discord.com/channels/${newMessage.guild.id}/${newMessage.channelId}/${newMessage.id})`,
            "",
            `**До:**\n${clipLogText(before)}`,
            "",
            `**После:**\n${clipLogText(after)}`,
            imageAttachment ? `\n**Вложение:** ${imageAttachment.url}` : ""
        ].filter(Boolean));
    } catch (error) {
        console.error("[MESSAGE UPDATE LOG ERROR]", error);
    }
});


// =====================================================
// CHANNEL LOGS — создание, удаление, переименование и права каналов
// =====================================================
function channelTypeName(channel) {
    if (channel.type === ChannelType.GuildCategory) return "Category";
    if (channel.isThread?.()) return "Thread";
    if (channel.isVoiceBased?.()) return "Voice";
    return "Text / Forum";
}

function channelLabel(channel, fallbackName = "без названия") {
    const name = clipLogText(channel?.name || fallbackName, 100);
    return channel?.type === ChannelType.GuildCategory ? `**${name}**` : `<#${channel.id}> (**${name}**)`;
}

function permissionTargetLabel(guild, overwrite, targetId) {
    if (targetId === guild.id) return "@everyone";
    if (overwrite?.type === 1) return `<@${targetId}>`;
    return `<@&${targetId}>`;
}

function permissionNames(permissionBitField) {
    try {
        const names = permissionBitField?.toArray?.() || [];
        return names.length ? names.join(", ") : "нет";
    } catch {
        return "не удалось определить";
    }
}

function getPermissionChanges(oldChannel, newChannel) {
    const oldOverwrites = oldChannel.permissionOverwrites?.cache || newChannel.permissionOverwrites?.cache;
    const newOverwrites = newChannel.permissionOverwrites?.cache || oldChannel.permissionOverwrites?.cache;
    if (!oldOverwrites || !newOverwrites) return [];

    const ids = new Set([...oldOverwrites.keys(), ...newOverwrites.keys()]);
    const changes = [];
    for (const id of ids) {
        const before = oldOverwrites.get(id);
        const after = newOverwrites.get(id);
        const beforeAllow = before?.allow?.bitfield?.toString() || "0";
        const afterAllow = after?.allow?.bitfield?.toString() || "0";
        const beforeDeny = before?.deny?.bitfield?.toString() || "0";
        const afterDeny = after?.deny?.bitfield?.toString() || "0";
        if (beforeAllow === afterAllow && beforeDeny === afterDeny) continue;

        const target = after || before;
        changes.push(
            `• ${permissionTargetLabel(newChannel.guild, target, id)} — ` +
            `**разрешено:** ${permissionNames(target?.allow)}; ` +
            `**запрещено:** ${permissionNames(target?.deny)}`
        );
    }
    return changes;
}

client.on(Events.ChannelCreate, async (channel) => {
    try {
        if (!channel.guild) return;
        const entry = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        await sendForumLog(channel.guild, "channelDelete", [
            `**Канал:** ${channelLabel(channel)}`,
            `**ID:** \`${channel.id}\``,
            `**Тип:** \`${channelTypeName(channel)}\``,
            `**Кто создал:** ${formatAuditExecutor(entry)}`,
            `**Категория:** ${channel.parentId ? `<#${channel.parentId}>` : "нет"}`
        ], { title: "📥 Канал создан", color: 0x2ECC71 });
    } catch (error) {
        console.error("[CHANNEL CREATE LOG ERROR]", error);
    }
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    try {
        if (!newChannel.guild) return;
        const nameChanged = oldChannel.name !== newChannel.name;
        const permissionChanges = getPermissionChanges(oldChannel, newChannel);
        if (!nameChanged && !permissionChanges.length) return;

        const entry = await findRecentAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        const lines = [
            `**Канал:** ${channelLabel(newChannel)}`,
            `**ID:** \`${newChannel.id}\``,
            `**Кто изменил:** ${formatAuditExecutor(entry)}`
        ];

        if (nameChanged) {
            lines.push(`**Название до:** ${clipLogText(oldChannel.name || "без названия")}`);
            lines.push(`**Название после:** ${clipLogText(newChannel.name || "без названия")}`);
        }
        if (permissionChanges.length) {
            lines.push("**Изменение прав:**");
            lines.push(...permissionChanges);
        }

        await sendForumLog(newChannel.guild, "channelDelete", lines, {
            title: nameChanged && permissionChanges.length
                ? "✏️ Изменение канала и прав"
                : nameChanged
                    ? "✏️ Изменение названия канала"
                    : "🔐 Изменение прав канала",
            color: 0xF1C40F
        });
    } catch (error) {
        console.error("[CHANNEL UPDATE LOG ERROR]", error);
    }
});

client.on(Events.ChannelDelete, async (channel) => {
    try {
        if (!channel.guild) return;
        const entry = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        await sendForumLog(channel.guild, "channelDelete", [
            `**Канал:** ${channelLabel(channel)}`,
            `**ID:** \`${channel.id}\``,
            `**Тип:** \`${channelTypeName(channel)}\``,
            `**Кто удалил:** ${formatAuditExecutor(entry)}`,
            `**Причина:** ${clipLogText(entry?.reason || "Причина не указана")}`
        ], { title: "📤 Канал удалён", color: 0xE74C3C });
    } catch (error) {
        console.error("[CHANNEL DELETE LOG ERROR]", error);
    }
});

// =====================================================
// PLUS SYSTEM — сбор плюсов на капт
// =====================================================
const plusEvents = new Map();

function plusTotalSlots(event) {
    return event.participants.size + event.extraParticipants.size;
}

function buildPlusContainer(event) {
    const occupied = plusTotalSlots(event);
    const participantEntries = [...event.participants.values()];
    const extraEntries = [...event.extraParticipants.values()];
    const participantsText = participantEntries.length
        ? participantEntries.map((participant, index) => `${index + 1}. <@${participant.userId}>`).join("\n")
        : "*Пока никто не присоединился.*";
    const extraSlotsText = extraEntries.length
        ? extraEntries.map((participant, index) => `${index + 1}. <@${participant.userId}>`).join("\n")
        : "*Дополнительных слотов нет.*";

    const container = new ContainerBuilder()
        .setAccentColor(0x2B2D31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ⚔️ Сбор плюсов — ${clipLogText(event.name, 120)}`))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Дата:** ${clipLogText(event.date, 120)}\n` +
            `**Слоты всего:** **${occupied} / ${event.slots}**\n` +
            `**Обычные слоты:** **${participantEntries.length}**\n` +
            `**Доп. слоты:** **${extraEntries.length}**\n` +
            `**Участников всего:** **${participantEntries.length + extraEntries.length}**`
        ))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 👥 Участники\n${participantsText}`))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ➕ Дополнительные слоты\n${extraSlotsText}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`plus_join_${event.id}`)
                .setLabel("Присоединиться")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`plus_leave_${event.id}`)
                .setLabel("Покинуть")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`plus_extra_${event.id}`)
                .setLabel("Доп слот")
                .setStyle(ButtonStyle.Secondary)
        ));

    return container;
}

// =====================================================
// CLEANUP COMMANDS — очистка сообщений и ролей
// =====================================================
const cleanupJobs = new Map();

function cleanupJobKey(guildId, type) {
    return `${guildId}:${type}`;
}

function beginCleanupJob(guildId, type) {
    const key = cleanupJobKey(guildId, type);
    const existing = cleanupJobs.get(key);
    if (existing && !existing.finished) return null;

    const job = { cancelled: false, finished: false };
    cleanupJobs.set(key, job);
    return job;
}

function finishCleanupJob(guildId, type, job) {
    job.finished = true;
    const key = cleanupJobKey(guildId, type);
    if (cleanupJobs.get(key) === job) cleanupJobs.delete(key);
}

function stopCleanupJob(guildId, type) {
    const job = cleanupJobs.get(cleanupJobKey(guildId, type));
    if (!job || job.finished) return false;
    job.cancelled = true;
    return true;
}

async function clearChannelMessages(channel, requestedAmount, job) {
    const unlimited = requestedAmount === "all";
    const target = unlimited ? Infinity : requestedAmount;
    const maxPasses = unlimited ? 500 : Math.ceil(target / 100) + 2;
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    let deleted = 0;
    let failed = 0;

    for (let pass = 0; pass < maxPasses && deleted < target; pass++) {
        if (job?.cancelled) break;
        const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!batch || batch.size === 0) break;

        const remaining = unlimited ? 100 : Math.min(100, target - deleted);
        const selected = batch.first(remaining);
        if (!selected.length) break;

        const recent = selected.filter(message => Date.now() - message.createdTimestamp < fourteenDays);
        const old = selected.filter(message => Date.now() - message.createdTimestamp >= fourteenDays);
        let progress = 0;

        if (recent.length > 1) {
            try {
                const result = await channel.bulkDelete(recent.map(message => message.id), true);
                const count = result?.size || 0;
                deleted += count;
                progress += count;
            } catch {
                // Если массовое удаление недоступно, пробуем удалить сообщения по одному.
                for (const message of recent) {
                    if (job?.cancelled) break;
                    try {
                        await message.delete();
                        deleted++;
                        progress++;
                    } catch {
                        failed++;
                    }
                    if (deleted >= target) break;
                }
            }
        } else if (recent.length === 1 && deleted < target) {
            try {
                await recent[0].delete();
                deleted++;
                progress++;
            } catch {
                failed++;
            }
        }

        for (const message of old) {
            if (job?.cancelled || deleted >= target) break;
            try {
                // Старше 14 дней Discord не удаляет bulkDelete — удаляем отдельно.
                await message.delete();
                deleted++;
                progress++;
            } catch {
                failed++;
            }
        }

        if (progress === 0) break;
        if (!unlimited && deleted >= target) break;
    }

    return { deleted, failed, stopped: !!job?.cancelled };
}

async function clearRolesFromAllHumanMembers(guild, job) {
    await guild.members.fetch();

    let processedMembers = 0;
    let removedRoles = 0;
    let skippedMembers = 0;
    let failedMembers = 0;

    for (const member of guild.members.cache.values()) {
        if (job?.cancelled) break;
        // Защита от случайного отключения самого бота, ботов и владельца сервера.
        if (member.user.bot || member.id === guild.ownerId) {
            skippedMembers++;
            continue;
        }

        // Нельзя снимать @everyone, managed-роли и роли выше бота.
        const removableRoles = member.roles.cache.filter(role =>
            role.id !== guild.id &&
            role.id !== MASS_ASSIGN_ROLE_ID &&
            !role.managed &&
            role.editable
        );
        if (!removableRoles.size) {
            skippedMembers++;
            continue;
        }

        try {
            await member.roles.remove([...removableRoles.keys()]);
            processedMembers++;
            removedRoles += removableRoles.size;
        } catch {
            failedMembers++;
        }
    }

    return { processedMembers, removedRoles, skippedMembers, failedMembers, stopped: !!job?.cancelled };
}


const MASS_ASSIGN_ROLE_ID = "1458410670071615580";

async function addRoleToAllMembers(guild, job) {
    const role = await guild.roles.fetch(MASS_ASSIGN_ROLE_ID).catch(() => null);
    if (!role) throw new Error(`Роль ${MASS_ASSIGN_ROLE_ID} не найдена.`);

    await guild.members.fetch();
    let added = 0;
    let alreadyHad = 0;
    let failed = 0;

    for (const member of guild.members.cache.values()) {
        if (job?.cancelled) break;
        if (member.roles.cache.has(role.id)) {
            alreadyHad++;
            continue;
        }

        try {
            // По запросу пользователя пробуем выдать роль всем, включая ботов и владельца.
            await member.roles.add(role);
            added++;
        } catch {
            // Discord не позволит изменить участника/роль выше бота — считаем это ошибкой.
            failed++;
        }
    }

    return { added, alreadyHad, failed, stopped: !!job?.cancelled };
}


// =====================================================
// INTERACTIONS & SLASH COMMANDS
// =====================================================
client.on(Events.InteractionCreate, async (i) => {
    try {
        if (!i.guild) return;
        const config = SERVERS[i.guild.id];

        if (i.isChatInputCommand()) {
            
            if (i.commandName !== "rank" && i.commandName !== "balance" && i.commandName !== "all" && i.commandName !== "mp_points" && i.commandName !== "mp_history" && i.commandName !== "afk_kick" && i.commandName !== "afk_list" && i.commandName !== "afk_panel") {
                if (!config) return;
                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) {
                    await i.reply({ content: "❌ Вы не имеете доступа к управлению этой командой.", flags: MessageFlags.Ephemeral });
                    return;
                }
            }

            if (i.commandName === "clear_stop") {
                const stopped = stopCleanupJob(i.guild.id, "messages");
                await i.reply({
                    content: stopped
                        ? "🛑 Удаление сообщений остановлено. Уже удалённые сообщения вернуть нельзя."
                        : "ℹ️ Сейчас удаление сообщений не выполняется.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (i.commandName === "add_role_all_stop") {
                const stopped = stopCleanupJob(i.guild.id, "add_role");
                await i.reply({
                    content: stopped
                        ? "🛑 Массовая выдача роли остановлена. Уже выданные роли автоматически не снимутся."
                        : "ℹ️ Сейчас массовая выдача роли не выполняется.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (i.commandName === "clear_roles_stop") {
                const stopped = stopCleanupJob(i.guild.id, "roles");
                await i.reply({
                    content: stopped
                        ? "🛑 Снятие ролей остановлено. Уже снятые роли автоматически не вернутся."
                        : "ℹ️ Сейчас массовое снятие ролей не выполняется.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (i.commandName === "add_role_all") {
                const job = beginCleanupJob(i.guild.id, "add_role");
                if (!job) {
                    await i.reply({ content: "⚠️ Массовая выдача роли уже выполняется. Для остановки используйте `/add_role_all_stop`.", flags: MessageFlags.Ephemeral });
                    return;
                }

                await i.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const result = await addRoleToAllMembers(i.guild, job);
                    await i.editReply({
                        content: `${result.stopped ? "🛑 Выдача роли остановлена" : "✅ Выдача роли завершена"}.\n` +
                            `Роль: <@&${MASS_ASSIGN_ROLE_ID}>\n` +
                            `Выдано: **${result.added}**\n` +
                            `Уже была: **${result.alreadyHad}**\n` +
                            `Ошибок: **${result.failed}**`
                    });
                } catch (error) {
                    console.error("[ADD ROLE ALL ERROR]", error);
                    await i.editReply({ content: `❌ Не удалось выдать роль <@&${MASS_ASSIGN_ROLE_ID}>. Проверьте, что роль находится ниже роли бота.` });
                } finally {
                    finishCleanupJob(i.guild.id, "add_role", job);
                }
                return;
            }

            if (i.commandName === "clear_roles") {
                const job = beginCleanupJob(i.guild.id, "roles");
                if (!job) {
                    await i.reply({ content: "⚠️ Снятие ролей уже выполняется. Для остановки используйте `/clear_roles_stop`.", flags: MessageFlags.Ephemeral });
                    return;
                }
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const result = await clearRolesFromAllHumanMembers(i.guild, job);
                    await i.editReply({
                        content: `${result.stopped ? "🛑 Очистка ролей остановлена" : "✅ Очистка ролей завершена"}.\n` +
                            `Участников обработано: **${result.processedMembers}**\n` +
                            `Ролей снято: **${result.removedRoles}**\n` +
                            `Пропущено: **${result.skippedMembers}**\n` +
                            `Ошибок: **${result.failedMembers}**`
                    });
                } catch (error) {
                    console.error("[CLEAR ROLES ERROR]", error);
                    await i.editReply({ content: "❌ Не удалось выполнить массовое снятие ролей. Проверьте права и иерархию ролей бота." });
                } finally {
                    finishCleanupJob(i.guild.id, "roles", job);
                }
                return;
            }

            if (i.commandName === "clear") {
                const rawAmount = i.options.getString("amount")?.trim().toLowerCase();
                const isAll = rawAmount === "all";
                const amount = Number.parseInt(rawAmount, 10);

                if (!isAll && (!Number.isInteger(amount) || amount < 1 || amount > 10000)) {
                    await i.reply({ content: "❌ Укажите число от **1** до **10000** или значение **all**.", flags: MessageFlags.Ephemeral });
                    return;
                }
                if (!i.channel?.messages) {
                    await i.reply({ content: "❌ В этом канале нельзя удалять сообщения.", flags: MessageFlags.Ephemeral });
                    return;
                }

                const job = beginCleanupJob(i.guild.id, "messages");
                if (!job) {
                    await i.reply({ content: "⚠️ Удаление сообщений уже выполняется. Для остановки используйте `/clear_stop`.", flags: MessageFlags.Ephemeral });
                    return;
                }

                await i.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const result = await clearChannelMessages(i.channel, isAll ? "all" : amount, job);
                    await i.editReply({
                        content: `${result.stopped ? "🛑 Удаление остановлено" : "✅ Удаление завершено"}. Удалено сообщений: **${result.deleted}**.` +
                            (result.failed ? ` Не удалось удалить: **${result.failed}**.` : "")
                    });
                } catch (error) {
                    console.error("[CLEAR MESSAGES ERROR]", error);
                    await i.editReply({ content: "❌ Не удалось очистить канал. Проверьте права Manage Messages и Read Message History." });
                } finally {
                    finishCleanupJob(i.guild.id, "messages", job);
                }
                return;
            }

            if (i.commandName === "plus") {
                const name = i.options.getString("name").trim();
                const date = i.options.getString("date").trim();
                const slots = i.options.getInteger("slots");
                const eventId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
                const event = {
                    id: eventId,
                    guildId: i.guild.id,
                    channelId: i.channel.id,
                    name,
                    date,
                    slots,
                    createdBy: i.user.id,
                    participants: new Map(),
                    extraParticipants: new Map()
                };
                plusEvents.set(eventId, event);

                try {
                    const message = await i.channel.send({
                        components: [buildPlusContainer(event)],
                        flags: MessageFlags.IsComponentsV2
                    });
                    event.messageId = message.id;
                    await i.reply({ content: `✅ Сбор плюсов создан: ${message.url}`, flags: MessageFlags.Ephemeral });
                } catch (error) {
                    plusEvents.delete(eventId);
                    console.error("[PLUS CREATE ERROR]", error);
                    await i.reply({ content: "❌ Не удалось создать контейнер сбора плюсов.", flags: MessageFlags.Ephemeral });
                }
                return;
            }

            if (i.commandName === "all") {
                const textMsg = i.options.getString("text"); 
                
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС (может занять время)...", flags: MessageFlags.Ephemeral });

                try {
                    await i.guild.members.fetch();
                    const targetMembers = i.guild.members.cache.filter(m => 
                        m.roles.cache.has("1458410756453306490") && 
                        !m.user.bot &&
                        !salary.afk[m.id]
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Оповещение от <@${i.user.id}>:**\n\n## ${textMsg} ##`);
                            successCount++;
                        } catch (e) {}
                    }
                    
                    await i.editReply({ content: `✅ Рассылка завершена! Сообщение доставлено: **${successCount}** участникам с ролью.` });
                } catch (e) {
                    console.error("[ALL COMMAND ERROR]", e);
                    await i.editReply({ content: "❌ Произошла ошибка при попытке рассылки в ЛС." });
                }
                return;
            }

            if (i.commandName === "balance") {
                const currentBal = salary.balances[i.user.id] || 0;
                await i.reply({ content: `💰 Баланс: $${currentBal.toLocaleString()}`, flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "reset_salary") {
                salary.balances = {};
                salary.recruits = {};
                salary.auditMessages = {};
                await saveDB(salary);
                await updateSalaryEmbed(i.guild);
                await i.reply({ content: "✅ Все балансы и привязки игроков были полностью аннулированы!", flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "deduct") {
                const targetUser = i.options.getUser("user");
                const amount    = i.options.getInteger("amount");

                const currentBal = salary.balances[targetUser.id] || 0;
                if (currentBal === 0) {
                    await i.reply({ content: `❌ У <@${targetUser.id}> баланс уже **$0** — списывать нечего.`, flags: MessageFlags.Ephemeral });
                    return;
                }

                const newBal = Math.max(0, currentBal - amount);
                salary.balances[targetUser.id] = newBal;
                await saveDB(salary);
                await updateSalaryEmbed(i.guild);

                await i.reply({
                    content: `✅ С баланса <@${targetUser.id}> списано **$${amount.toLocaleString()}**.\nБыло: **$${currentBal.toLocaleString()}** → Стало: **$${newBal.toLocaleString()}**`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (i.commandName === "add_salary") {
                const targetUser = i.options.getUser("user");
                const amount     = i.options.getInteger("amount");

                const currentBal = salary.balances[targetUser.id] || 0;
                const newBal = currentBal + amount;
                salary.balances[targetUser.id] = newBal;
                await saveDB(salary);
                await updateSalaryEmbed(i.guild);

                await i.reply({
                    content: `✅ Рекруту <@${targetUser.id}> начислено **$${amount.toLocaleString()}**.\nБыло: **$${currentBal.toLocaleString()}** → Стало: **$${newBal.toLocaleString()}**`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }


            // =====================================================
            // МП ПАНЕЛЬ
            // =====================================================
            if (i.commandName === "mp_panel") {
                const mpMenuRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("mp_select_type")
                        .setPlaceholder("Выберите МПшку для отчёта")
                        .addOptions(
                            { label: "Цеха", description: "+15 win / +7 lose", value: "Цеха", emoji: "🏭" },
                            { label: "Диллеры", description: "+15 win / +7 lose", value: "Диллеры", emoji: "💊" },
                            { label: "Дроп", description: "+20 win / +10 lose", value: "Дроп", emoji: "📦" },
                            { label: "Бизаки", description: "+8 win / +3 lose", value: "Бизаки", emoji: "💼" },
                            { label: "Арена", description: "+4 win / +0 lose", value: "Арена", emoji: "🏟️" },
                            { label: "Остров", description: "+15 win / +7 lose", value: "Остров", emoji: "🏝️" },
                            { label: "Тайники", description: "+5 win / +2 lose", value: "Тайники", emoji: "🗺️" },
                            { label: "Капт", description: "+20 win / +10 lose", value: "Капт", emoji: "⚔️" }
                        )
                );

                const mpPanelText = `@everyone
# СИСТЕМА ПОВЫШЕНИЯ
**•  1 → 2 РАНГ**
<:df:1516907994552602634> 50 PR + фамилия • 3+ дня в семье,
<:df:1516907994552602634> Фамилия \`Darkness\`

**•  2 → 3 РАНГ**
<:df:1516907994552602634> 100 PR • 14+ дней в семье

**•  3 → 4 РАНГ | Main RP and Capture**
<:df:1516907994552602634> 150 PR • заявка → <#1503001219201761301>
<:df:1516907994552602634> 20+ дней • адекватность

**•  5 РАНГ — Recruit**
<:df:1516907994552602634> Заявка → <#1499701507619291206>

**•  6 РАНГ** — High and Chief - Rec, Capt, Farm
**•  7 РАНГ** — Dep. Leader
**•  8 РАНГ** — Owner
————————————————————————————————————————————————
# СЕМЕЙНЫЕ БАЛЛЫ
Цеха: \`+15\` WIN | \`+7\` LOSE
Диллеры: \`+15\` WIN | \`+7\` LOSE
Дроп: \`+20\` WIN | \`+10\` LOSE
Бизаки: \`+8\` WIN | \`+3\` LOSE
Арена: \`+4\` 1st | \`+0\` LOSE
Остров: \`+15\` WIN | \`+7\` LOSE
Тайники: \`+5\` WIN | \`+2\` LOSE
Капт: \`+20\` WIN | \`+10\` LOSE`;

                await i.channel.send({ content: mpPanelText, components: [mpMenuRow], allowedMentions: { parse: ["everyone"] } });
                await i.reply({ content: "✅ Панель МП отчётов создана!", flags: MessageFlags.Ephemeral });
                return;
            }

            // =====================================================
            // МП БАЛЛЫ
            // =====================================================
            if (i.commandName === "mp_deduct") {
                const targetUser = i.options.getUser("user");
                const amount = i.options.getInteger("amount");
                const current = salary.mpPoints[targetUser.id] || 0;

                if (current === 0) {
                    await i.reply({ content: `❌ У <@${targetUser.id}> баллов уже **0** — снимать нечего.`, flags: MessageFlags.Ephemeral });
                    return;
                }

                const newPoints = Math.max(0, current - amount);
                salary.mpPoints[targetUser.id] = newPoints;
                await saveDB(salary);

                await i.reply({
                    content: `✅ С <@${targetUser.id}> снято **${amount}** МП баллов.\nБыло: **${current}** → Стало: **${newPoints}**`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (i.commandName === "add_points") {
                const targetUser = i.options.getUser("user");
                const amount = i.options.getInteger("amount");
                const current = salary.mpPoints[targetUser.id] || 0;

                const newPoints = current + amount;
                salary.mpPoints[targetUser.id] = newPoints;
                await saveDB(salary);

                await i.reply({
                    content: `✅ <@${targetUser.id}> начислено **${amount}** МП баллов.\nБыло: **${current}** → Стало: **${newPoints}**`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (i.commandName === "mp_points") {
                const targetUser = i.options.getUser("user") || i.user;
                const points = salary.mpPoints[targetUser.id] || 0;
                const history = salary.mpHistory[targetUser.id] || [];
                const lastEntries = history.slice(-5).reverse();

                let historyText = lastEntries.length > 0
                    ? lastEntries.map(h => `• **${h.mp}** — ${h.result === "win" ? "✅ Win" : "❌ Lose"} (+${h.points} баллов) <t:${h.ts}:R>`).join("\n")
                    : "*Нет отчётов.*";

                const embed = new EmbedBuilder()
                    .setTitle("🎮 МП Баллы")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Игрок:** <@${targetUser.id}>\n🏆 **Всего баллов:** \`${fmtPoints(points)}\`\n\n**Последние 5 МПшек:**\n${historyText}`)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            // =====================================================
            // МП ИСТОРИЯ СКРИНОВ (ВЕТКА)
            // =====================================================
            if (i.commandName === "mp_history") {
                const targetUser = i.options.getUser("user");
                const history = salary.mpHistory[targetUser.id] || [];

                if (history.length === 0) {
                    await i.reply({ content: `❌ У <@${targetUser.id}> нет ни одного принятого отчёта.`, flags: MessageFlags.Ephemeral });
                    return;
                }

                await i.deferReply({ flags: MessageFlags.Ephemeral });

                const thread = await i.channel.threads.create({
                    name: `МП скрины — ${targetUser.username}`,
                    autoArchiveDuration: 1440,
                    reason: `История МП скринов игрока ${targetUser.username}`
                }).catch(() => null);

                if (!thread) {
                    await i.editReply({ content: "❌ Не удалось создать ветку. Убедитесь что бот имеет права на создание тредов." });
                    return;
                }

                const headerEmbed = new EmbedBuilder()
                    .setTitle(`🗂️ История МП скринов | ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Игрок:** <@${targetUser.id}>\n🏆 **Всего баллов:** \`${salary.mpPoints[targetUser.id] || 0}\`\n📋 **Всего отчётов:** \`${history.length}\``)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await thread.send({ embeds: [headerEmbed] });

                for (const entry of history) {
                    const entryEmbed = new EmbedBuilder()
                        .setTitle(`${entry.result === "win" ? "✅" : "❌"} ${entry.mp} — ${entry.result === "win" ? "Win" : "Lose"}`)
                        .setDescription(`+**${entry.points}** баллов | <t:${entry.ts}:F>`)
                        .setColor(entry.result === "win" ? "Green" : "Red");

                    if (entry.imageUrl) entryEmbed.setImage(entry.imageUrl);
                    await thread.send({ embeds: [entryEmbed] }).catch(() => null);
                }

                await i.editReply({ content: `✅ Ветка со всеми скринами создана: ${thread}` });
                return;
            }

            if (i.commandName === "rank") {
                const targetUser = i.options.getUser("user") || i.user;
                const totalReports = salary.reports[targetUser.id] || 0;
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                
                let currentRankName = "Отсутствует / Гость";
                if (targetMember) {
                    if (targetMember.roles.cache.has("1513647909965533377")) currentRankName = "TEST [1 Rank]";
                    else if (targetMember.roles.cache.has("1458485405769797848")) currentRankName = "Academy [2 Rank]";
                    else if (targetMember.roles.cache.has("1458485351424331903")) currentRankName = "Young [3 Rank]";
                    else if (targetMember.roles.cache.has("1458485277495656553")) currentRankName = "Darkness [4 Rank]";
                }

                const rankEmbed = new EmbedBuilder()
                    .setTitle("📊 Профиль квалификации и ранга")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Пользователь:** <@${targetUser.id}>\nℹ️ **Текущий ранг:** \`${currentRankName}\`\n✅ **Всего одобренных отчетов:** \`${totalReports}\``)
                    .setColor("#2b2d31")
                    .setTimestamp();

                await i.reply({ embeds: [rankEmbed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "info") {
                const targetUser = i.options.getUser("user");
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                
                if (!targetMember) {
                    await i.reply({ content: "❌ Пользователь не найден на сервере.", flags: MessageFlags.Ephemeral });
                    return;
                }

                const archiveData = salary.archive[targetUser.id];
                const acceptedByText = archiveData ? `<@${archiveData.acceptedBy}>` : "`Данные отсутствуют`";
                
                const joinedDiff = Date.now() - targetMember.joinedAt.getTime();
                const daysOnServer = Math.floor(joinedDiff / (1000 * 60 * 60 * 24));

                const infoEmbed = new EmbedBuilder()
                    .setTitle("📂 Личное дело участника")
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setDescription(`👤 **Пользователь:** <@${targetUser.id}>\n🆔 **Discord ID:** \`${targetUser.id}\`\n📝 **Кто принял в тикете:** ${acceptedByText}\n⏳ **Времени на сервере:** \`${daysOnServer} дней\` (c ${targetMember.joinedAt.toLocaleDateString("ru-RU")})`)
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder();
                if (archiveData) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`view_archive_app_${targetUser.id}`)
                            .setLabel("Посмотреть анкету заявки")
                            .setStyle(ButtonStyle.Secondary)
                    );
                    await i.reply({ embeds: [infoEmbed], components: [row], flags: MessageFlags.Ephemeral });
                } else {
                    await i.reply({ embeds: [infoEmbed], flags: MessageFlags.Ephemeral });
                }
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ЗАЯВОК В СЕМЬЮ — КОНТЕЙНЕР
            // =====================================================
            if (i.commandName === "panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.PANEL) return;
                const channel = await client.channels.fetch(config.CHANNELS.PANEL);

                const PANEL_BANNER_URL = "https://media.discordapp.net/attachments/1540014036081446922/1541149637073961141/ChatGPT_Image_21_._2026_._11_35_24.png?ex=6a8c8af2&is=6a8b3972&hm=79aaf5715073d6094f9977a05ad0cb4de4628af7186a7bf146fdf38216a904e4&=&format=webp&quality=lossless";

                const panelContainer = {
                    components: [
                        {
                            type: 17, // Container
                            accent_color: 0x2b2d31,
                            components: [
                                {
                                    type: 12, // Media Gallery
                                    items: [
                                        {
                                            media: {
                                                url: PANEL_BANNER_URL
                                            }
                                        }
                                    ]
                                },
                                {
                                    type: 10, // Text Display
                                    content: "## <:hello:1516906998715912334> Путь в семью начинается здесь!\n\n-# <:df:1516907994552602634> Заявки в семью принимаются только на сервере **Orlando**.\n<:df:1516907994552602634> **Внимательно прочитайте все пункты** при подаче заявки. **Если не ответили на все пункты** — заявка будет **отклонена**.\n\n**・Срок рассмотрения заявки:** от 1 до 5 дней.\n**・Важно:** если у вас нет подходящих откатов — заявка будет **отклонена**.\n\n### - Дополнительные правила к подаче заявки:\n<:df:1516907994552602634> Откаты с GG — не более 1 недели назад (не менее 6 минут).\n<:df:1516907994552602634> Откаты с МП (ВЗЗ, MCL, Capt) — не более 60 дней назад. — **__при наличии!__**\n<:df:1516907994552602634> Откаты должны быть не в виде мувика/нарезки.\n<:df:1516907994552602634> Откаты должны быть с сайги и со спешика (минимум 2 отката).\n<:df:1516907994552602634> Подать заявку можно только при открытом наборе. Если нет доступа к подаче — набор закрыт.\n**・Выберите пункт в выпадающем меню:**"
                                },
                                {
                                    type: 1, // Action Row
                                    components: [
                                        {
                                            type: 3, // String Select Menu
                                            custom_id: "apply_menu",
                                            placeholder: "Нажмите на меня, чтобы открыть меню",
                                            options: [
                                                { label: "Academy", description: "Ник, статик, имя/возраст, онлайн, семья", value: "academy" },
                                                { label: "Capture", description: "Ник, статик, имя/возраст, онлайн, семья, откаты", value: "capture" }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ],
                    flags: 1 << 15 // IS_COMPONENTS_V2
                };

                await channel.send(panelContainer);
                await i.reply({ content: "✅ Панель успешно создана!", flags: MessageFlags.Ephemeral });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ЗАЯВКИ В MAIN СОСТАВ
            // =====================================================
            if (i.commandName === "main_panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.MAIN) return;
                const channel = await client.channels.fetch(config.CHANNELS.MAIN);

                const embed = new EmbedBuilder()
                    .setColor("#2b2d31")
                    .setDescription(
`## Заявка в Main состав

Main состав — основа нашей семьи. Здесь играют люди, готовые участвовать во всём контенте семьи: капты, MCL, турниры, и т.д.

**Требования для подачи:**
• Откаты стрельбы от 5 минут с GG
• или откаты с любой МП/капта/массового мероприятия

━━━━━━━━━━━━━━

**Важно:**
• Заявки без откатов не рассматриваются
• Рассмотрение занимает от 2 до 4 дней
• Подгонять администрацию запрещено
• Если заявка отклонена — решение окончательное

**Вступая в Main состав, вы становитесь частью основного комьюнити Darkness и участвуете во всём семейном контенте.**`
                    );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_main_modal")
                        .setLabel("Подать заявку")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель заявки в Main успешно создана!", flags: MessageFlags.Ephemeral });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ЗАЯВКИ В RECRUIT ОТДЕЛ
            // =====================================================
            if (i.commandName === "recruit_panel") {
                if (!config || !config.CHANNELS || !config.CHANNELS.RECRUIT) return;
                const channel = await client.channels.fetch(config.CHANNELS.RECRUIT);

                const RECRUIT_BANNER_URL = "https://cdn.discordapp.com/attachments/1540014036081446922/1540312552729485312/ChatGPT_Image_21_._2026_._13_51_56.png?ex=6a897f5a&is=6a882dda&hm=f35104585919ffe811048b944ac75553840f2642384210aba7ea2de2a524ab92&";

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("recruit_apply_menu")
                        .setPlaceholder("Нажмите на меня, чтобы открыть меню")
                        .addOptions({
                            label: "Подать заявку",
                            description: "Заполнить анкету в отдел Recruit",
                            value: "open_recruit_modal"
                        })
                );

                const recruitPanelContainer = new ContainerBuilder()
                    .setAccentColor(0x2B2D31)
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL(RECRUIT_BANNER_URL)
                        )
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent("# Отдел recruit\n-# Darkness Family · набор в команду")
                    )
                    .addSeparatorComponents(new SeparatorBuilder())
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
`**Recruit** — отдел, отвечающий за набор новых участников и развитие семьи.

### Что делает отдел
• ищет и приглашает новых игроков;
• помогает новичкам освоиться в семье;
• поддерживает актив и атмосферу Darkness.

### Важно
• отвечайте на вопросы честно и подробно;
• соблюдайте адекватность и уважение;
• срок рассмотрения заявки — до **4 дней**.`
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder())
                    .addActionRowComponents(row);

                await channel.send({
                    components: [recruitPanelContainer],
                    flags: MessageFlags.IsComponentsV2
                });
                await i.reply({ content: "✅ Панель заявки в Recruit успешно создана!", flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "report_panel") {
                const embed = new EmbedBuilder()
                    .setDescription(
`Повышение выдается только при соблюдении всех требований и по решению старшего состава семьи.

### 📝 TEST ➔ 🧬 ACADEMY ###
**Требования:**
• 5 МП
• Фамилия Darkness
• Знание правил семьи и сервера
• Актив в игре больше 3 часов в день

### 🔮 ACADEMY ➔ 🍸 YOUNG ###
**Требования:**
• 10 МП суммарно
• Умение слушать и выполнять коллы
• Грамотная и адекватная игра
• Отсутствие серьёзных нарушений, варнов, жалоб со стороны софракцевцев, софамцев

### 🍸 YOUNG ➔ 🟣 DARKNESS ###
**Требования:**
• 20 МП суммарно
• Стабильный онлайн (больше 100 часов in игре)
• Помощь семье
• Хорошая коммуникация

### 🟣 DARKNESS ➔ 👑 RECRUIT ###
**Требования:**
• Уметь грамотно общаться
• Стабильный онлайн (3+ часа в день)
• Адекватность
• Иметь ответственность

━━━━━━━━━━━━━━━
⚠️ Повышение не выдаётся автоматически без ручного одобрения старшего состава в планшете. Нажмите кнопку ниже, чтобы прикрепить доказательства.`)
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_report_modal")
                        .setLabel("Подать отчет")
                        .setStyle(ButtonStyle.Secondary)
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Широкая панель системы повышения призвана!", flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "afk_panel") {
                const config = SERVERS[i.guild.id];
                const afkChannelId = config?.CHANNELS?.AFK || "1520898805103595772";
                const channel = await i.guild.channels.fetch(afkChannelId).catch(() => null);
                if (!channel) return i.reply({ content: "❌ Канал АФК не найден.", flags: MessageFlags.Ephemeral });

                await updateAFKEmbed(i.guild);
                await i.reply({ content: "✅ АФК панель обновлена и отправлена в канал.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "afk_list") {
                await updateAFKEmbed(i.guild);
                await i.reply({ content: "✅ АФК список обновлён в канале.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "afk_kick") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });

                const config = SERVERS[i.guild.id];
                const hasPermission = config?.ALLOWED_ROLES?.some(role => i.member.roles.cache.has(role));
                if (!hasPermission) {
                    await i.editReply({ content: "❌ У вас нет прав для использования этой команды." });
                    return;
                }

                const targetUser = i.options.getUser("user");
                const reason = i.options.getString("reason");

                if (targetUser.id === i.user.id) {
                    await i.editReply({ content: "❌ Нельзя кикнуть самого себя из АФК. Используйте кнопку «Вернулся из АФК» в канале." });
                    return;
                }

                if (!salary.afk[targetUser.id]) {
                    await i.editReply({ content: `❌ <@${targetUser.id}> не находится в АФК.` });
                    return;
                }

                const afkData = salary.afk[targetUser.id];
                delete salary.afk[targetUser.id];
                await saveDB(salary);
                await updateAFKEmbed(i.guild);
                await sendForumLog(i.guild, "afkLeave", [
                    `**Участник:** <@${targetUser.id}>`,
                    `**Причина AFK:** ${clipLogText(afkData?.reason || "афк")}`,
                    `**Кто снял статус:** <@${i.user.id}>`,
                    `**Причина снятия:** ${clipLogText(reason || "Причина не указана")}`
                ]);

                let dmSent = false;
                const targetMember = await i.guild.members.fetch(targetUser.id).catch(() => null);
                if (targetMember) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle("🚫 Вас кикнули из АФК")
                        .setDescription(`Администратор <@${i.user.id}> принудительно снял ваш АФК статус.\n\n**Причина:** ${reason}`)
                        .setColor("Red")
                        .setTimestamp();
                    dmSent = await targetMember.send({ embeds: [dmEmbed] }).then(() => true).catch(() => false);
                }

                await i.editReply({
                    content: `✅ <@${targetUser.id}> удалён из АФК.\n${dmSent ? "📩 ЛС с причиной отправлено." : "⚠️ ЛС не доставлено (закрыты личные сообщения)."}\n**Причина:** ${reason}`
                });
                return;
            }

            if (i.commandName === "composition_panel") {
                await updateOnlineMonitor();
                await i.reply({ content: "✅ Панель состава обновлена и вызвана.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.commandName === "group_panel") {
                const channel = await client.channels.fetch("1508112178610438327").catch(() => null);
                if (!channel) {
                    await i.reply({ content: "❌ Канал 'групп' не найден или у бота нет туда доступа.", flags: MessageFlags.Ephemeral });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle("📡 Управление сборами групп")
                    .setDescription(
                        "Используйте кнопки ниже для запуска ручного управления сборами состава.\n\n" +
                        "**Функционал:**\n" +
                        "• Выбор типа мероприятия\n" +
                        "• Ручная панель с кнопками отправки в канал и ЛС\n\n" +
                        "**Darkness & Ballas Central Control**"
                    )
                    .setColor("#2b2d31");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("group_start_ballas")
                        .setLabel("Ballas Gang")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("🍇"),
                    new ButtonBuilder()
                        .setCustomId("group_start_darkness")
                        .setLabel("Darkness Family")
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji("🌑")
                );

                await channel.send({ embeds: [embed], components: [row] });
                await i.reply({ content: "✅ Панель сборов отправлена!", flags: MessageFlags.Ephemeral });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ МАГАЗИНА — контейнер с баннером и товарами
            // =====================================================
            if (i.commandName === "shop_panel") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });

                const SHOP_BANNER_URL = "https://cdn.discordapp.com/attachments/1540014036081446922/1540287038916526100/ChatGPT_Image_21_._2026_._12_10_20.png?ex=6a896797&is=6a881617&hm=f27de9f632adc54a3a42da4030571f1f5f65e407d67cc15f3598e239ba33ce08&";

                const shopContainer = {
                    components: [
                        {
                            type: 17, // Container
                            accent_color: 0x2b2d31,
                            components: [
                                {
                                    type: 12, // Media Gallery
                                    items: [
                                        {
                                            media: {
                                                url: SHOP_BANNER_URL
                                            }
                                        }
                                    ]
                                },
                                {
                                    type: 10, // Text Display
                                    content: "## Семейный магазин баллов"
                                },
                                {
                                    type: 10, // Text Display
                                    content:
                                        "Обменивайте накопленные баллы на ценные призы и возможности.\n\n" +
                                        "**Фарм:** 0.015 балла/мин (1 балл = 66.7 мин)\n" +
                                        "• Баллы идут за время в голосовых каналах.\n" +
                                        "• Не начисляются в АФК-канале или когда вы один в голосовом канале.\n" +
                                        "• Дополнительно выдаются за RP-скрины."
                                },
                                {
                                    type: 1, // Action Row
                                    components: [
                                        {
                                            type: 2,
                                            style: 2,
                                            label: "Баланс",
                                            custom_id: "shop_balance",
                                            emoji: { name: "💰" }
                                        }
                                    ]
                                },
                                { type: 14 }, // Separator
                                {
                                    type: 9, // Section
                                    components: [
                                        {
                                            type: 10,
                                            content: "**Снять выговор**\nСнимает 1 предупреждение.\nЦена: 50"
                                        }
                                    ],
                                    accessory: {
                                        type: 2,
                                        style: 2,
                                        label: "Купить",
                                        custom_id: "shop_buy_warn",
                                        emoji: { name: "⚠️" }
                                    }
                                },
                                { type: 14 }, // Separator
                                {
                                    type: 9, // Section
                                    components: [
                                        {
                                            type: 10,
                                            content: "**100,000 игровой валюты**\nРучная выдача через администрацию.\nЦена: 100"
                                        }
                                    ],
                                    accessory: {
                                        type: 2,
                                        style: 2,
                                        label: "Купить",
                                        custom_id: "shop_buy_cash",
                                        emoji: { name: "💵" }
                                    }
                                },
                                { type: 14 }, // Separator
                                {
                                    type: 9, // Section
                                    components: [
                                        {
                                            type: 10,
                                            content: "**main**\nповышение до роли main\nАвтоматически выдаёт роль <@&1540314966278807622>.\nЦена: 500"
                                        }
                                    ],
                                    accessory: {
                                        type: 2,
                                        style: 2,
                                        label: "Купить",
                                        custom_id: "shop_buy_main",
                                        emoji: { name: "📈" }
                                    }
                                }
                            ]
                        }
                    ],
                    flags: 1 << 15 // IS_COMPONENTS_V2
                };

                await i.channel.send(shopContainer);
                await i.editReply({ content: "✅ Панель магазина успешно создана!" });
                return;
            }

            // =====================================================
            // ПАНЕЛЬ ВЗАИМОДЕЙСТВИЯ — контейнер с баннером и кнопками
            // =====================================================
            if (i.commandName === "interaction_panel") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });

                const BANNER_URL = "https://cdn.discordapp.com/attachments/1540014036081446922/1540283283227541625/ChatGPT_Image_21_._2026_._11_55_37.png?ex=6a896417&is=6a881297&hm=63ab8d52865c69d26e030f42afef6bf11c16404f12aa3a8ad79f6f84e4e2a768&";

                const containerMessage = {
                    components: [
                        {
                            type: 17, // Container
                            accent_color: 0x2b2d31,
                            components: [
                                {
                                    type: 12, // Media Gallery
                                    items: [
                                        {
                                            media: {
                                                url: BANNER_URL
                                            }
                                        }
                                    ]
                                },
                                {
                                    type: 10, // Text Display
                                    content: "## Взаимодействие с функционалом бота"
                                },
                                {
                                    type: 10, // Text Display — серая линия через markdown цитату
                                    content: "> 🏖️ **Отпуск** — взять долгосрочный отпуск, отдых от игры.\n> 💼 **Портфель** — кнопка «Портфель» открывает ваш личный портфель.\n> 🛒 **Магазин** — открыть магазин и потратить баллы."
                                },
                                {
                                    type: 1, // Action Row
                                    components: [
                                        {
                                            type: 2,
                                            style: 2,
                                            label: "Отпуск",
                                            custom_id: "interaction_vacation",
                                            emoji: { name: "🏖️" }
                                        },
                                        {
                                            type: 2,
                                            style: 2,
                                            label: "Портфель",
                                            custom_id: "interaction_portfolio",
                                            emoji: { name: "💼" }
                                        },
                                        {
                                            type: 2,
                                            style: 5,
                                            label: "Магазин",
                                            url: `https://discord.com/channels/${i.guild.id}/1521510886794072147`,
                                            emoji: { name: "🛒" }
                                        }
                                    ]
                                }
                            ]
                        }
                    ],
                    flags: 1 << 15 // IS_COMPONENTS_V2
                };

                await i.channel.send(containerMessage);
                await i.editReply({ content: "✅ Панель взаимодействия успешно создана!" });
                return;
            }
        } // end isChatInputCommand


        // =====================================================
        // МП КНОПКА СТАРТ — выбор типа МПшки
        // =====================================================
        // =====================================================
        // МП ВЫБОР ТИПА → показ выбора результата
        // =====================================================
        if (i.isStringSelectMenu() && i.customId === "mp_select_type") {
            const selectedMp = i.values[0];

            const resultMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`mp_select_result_${selectedMp}`)
                    .setPlaceholder("Выберите результат")
                    .addOptions(
                        { label: "Win (Победа)", value: "win", emoji: "✅" },
                        { label: "Lose (Поражение)", value: "lose", emoji: "❌" }
                    )
            );

            await i.reply({
                content: `🎮 **МП:** ${selectedMp}

**Шаг 2:** Выберите результат:`,
                components: [resultMenu],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // =====================================================
        // МП ВЫБОР РЕЗУЛЬТАТА → просьба скинуть скрин
        // =====================================================
        if (i.isStringSelectMenu() && i.customId.startsWith("mp_select_result_")) {
            const mpType = i.customId.replace("mp_select_result_", "");
            const result = i.values[0];
            const points = MP_TYPES[mpType] ? MP_TYPES[mpType][result] : 0;

            // Выдаём временный доступ на отправку сообщений и файлов в этот канал
            await i.channel.permissionOverwrites.edit(i.user.id, {
                SendMessages: true,
                AttachFiles: true,
                ViewChannel: true
            }).catch(() => null);

            // Сохраняем в Map для ожидания скрина
            applications.set(`mp_await_${i.user.id}`, { mpType, result, points, channelId: i.channelId });

            const uploadEmbed = new EmbedBuilder()
                .setColor("#5865F2")
                .setTitle("📎 Загрузка доказательства")
                .setDescription(
                    `✅ **МП:** ${mpType} | **Результат:** ${result === "win" ? "Win ✅" : "Lose ❌"} | **Баллы:** +${points}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📂 **Шаг 3: Отправьте фото или ссылку на доказательство**\n\n` +
                    `> 🖼️ Прикрепите изображение к сообщению или вставьте URL\n` +
                    `> Можно отправить 1 файл размером не более **10 МБ**\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `⚠️ *У вас есть **1 минута** на отправку скриншота. После этого доступ будет закрыт.*`
                )
                .setFooter({ text: "Поддерживаются форматы: PNG, JPG, JPEG, WEBP" })
                .setTimestamp();

            await i.update({
                content: "",
                embeds: [uploadEmbed],
                components: []
            });

            // Таймер: если за 60 секунд скрин не пришёл — убираем доступ
            setTimeout(async () => {
                if (applications.has(`mp_await_${i.user.id}`)) {
                    applications.delete(`mp_await_${i.user.id}`);
                    await i.channel.permissionOverwrites.delete(i.user.id).catch(() => null);
                    await i.channel.send({ content: `⏰ <@${i.user.id}>, время вышло! Вы не успели отправить скриншот. Начните заново.` })
                        .then(m => setTimeout(() => m.delete().catch(() => null), 8000))
                        .catch(() => null);
                }
            }, 60000);
            return;
        }

        // =====================================================
        // МП КНОПКИ ПРИНЯТЬ / ОТКЛОНИТЬ (в канале модерации)
        // =====================================================
        if (i.isButton() && i.customId.startsWith("mp_accept_")) {
            const parts = i.customId.split("_");
            // mp_accept_USERID_MP_RESULT_POINTS_CHANNELID
            const userId = parts[2];
            const mpType = parts[3];
            const result = parts[4];
            const points = parseInt(parts[5]);
            const panelChannelId = parts[6] || null;

            salary.mpPoints[userId] = (salary.mpPoints[userId] || 0) + points;
            if (!salary.mpHistory[userId]) salary.mpHistory[userId] = [];

            // Получаем url картинки из embed
            const reviewMeta = reportReviewMeta.get(i.message.id) || {};
            const imgUrl = i.message.attachments?.first()?.url || reviewMeta.evidenceUrl || null;
            const imgName = i.message.attachments?.first()?.name || null;

            salary.mpHistory[userId].push({
                mp: mpType, result, points,
                ts: Math.floor(Date.now() / 1000),
                imageUrl: imgUrl
            });

            await saveDB(salary);

            const acceptContainer = buildReportReviewContainer({
                userId,
                title: `<@${userId}>`,
                details: `**Статус:** ✅ МП отчёт принят\n**МПшка:** ${mpType}\n**Результат:** ${result === "win" ? "Win" : "Lose"}\n**Баллов начислено:** +${points}\n**Принял:** <@${i.user.id}>`,
                color: 0x2ECC71,
                evidenceUrl: imgUrl,
                attachmentName: imgName
            });
            await i.update({ components: [acceptContainer], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
            reportReviewMeta.delete(i.message.id);
            await sendPortfolioReportStatus(i.guild, userId, {
                status: "Принят",
                type: `МПшка ${mpType}`,
                details: `**Результат:** ${result === "win" ? "Win" : "Lose"}\n**Баллов:** +${points}\n**Принял:** <@${i.user.id}>`,
                evidenceUrl: imgUrl
            });

            // Уведомляем игрока в канале уведомлений
            const acceptNotifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (acceptNotifChannel) {
                await acceptNotifChannel.send({
                    content: `✅ <@${userId}>, ваш отчёт по МПшке **${mpType}** (${result === "win" ? "Win" : "Lose"}) **принят!** Начислено **+${points}** баллов. Всего баллов: **${salary.mpPoints[userId]}**`
                }).catch(() => null);
            }

            // Проверяем пороги повышения ранга
            const totalPts = salary.mpPoints[userId];
            const member = await i.guild.members.fetch(userId).catch(() => null);
            if (member) {
                for (const threshold of MP_RANK_THRESHOLDS) {
                    if (totalPts >= threshold.points && member.roles.cache.has(threshold.from)) {
                        const reviewChan = await client.channels.fetch(MP_REVIEW_CHANNEL).catch(() => null);
                        if (reviewChan) {
                            const rankEmbed = new EmbedBuilder()
                                .setTitle(`🏆 Повышение ранга | ${threshold.label}`)
                                .setDescription(`👤 **Игрок:** <@${userId}>
📊 **Баллов:** \`${totalPts}\`
🎯 **Порог:** \`${threshold.points}\`

⬆️ Готов к повышению: **${threshold.label}**`)
                                .setColor("Gold")
                                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                                .setTimestamp();

                            const rankRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`rank_accept_${userId}_${threshold.from}_${threshold.to}_${threshold.points}`)
                                    .setLabel("✅ Повысить")
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`rank_reject_${userId}_${threshold.points}`)
                                    .setLabel("❌ Отказать")
                                    .setStyle(ButtonStyle.Danger)
                            );

                            await reviewChan.send({ embeds: [rankEmbed], components: [rankRow] });
                        }
                        break; // только один порог за раз
                    }
                }
            }
            return;
        }

        if (i.isButton() && i.customId.startsWith("mp_reject_")) {
            const parts = i.customId.split("_");
            const userId = parts[2];
            const mpType = parts[3];

            const rejectContainer = buildReportReviewContainer({
                userId,
                title: `<@${userId}>`,
                details: `**Статус:** ❌ МП отчёт отклонён\n**МПшка:** ${mpType}\n**Отклонил:** <@${i.user.id}>`,
                color: 0xE74C3C
            });
            await i.update({ components: [rejectContainer], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
            const rejectMeta = reportReviewMeta.get(i.message.id) || {};
            reportReviewMeta.delete(i.message.id);
            await sendPortfolioReportStatus(i.guild, userId, {
                status: "Отклонён",
                type: `МПшка ${mpType}`,
                details: `**Отклонил:** <@${i.user.id}>`,
                evidenceUrl: rejectMeta.evidenceUrl || null
            });

            // Уведомление в канал отклонений
            const rejectChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (rejectChannel) {
                await rejectChannel.send({ content: `❌ <@${userId}>, ваш отчёт по МПшке **${mpType}** был **отклонён**.` });
            }
            return;
        }


        // =====================================================
        // РАНГ КНОПКА — ПОВЫСИТЬ
        // =====================================================
        if (i.isButton() && i.customId.startsWith("rank_accept_")) {
            const parts = i.customId.split("_");
            // rank_accept_USERID_FROMROLE_TOROLE_THRESHOLD
            const userId = parts[2];
            const fromRole = parts[3];
            const toRole = parts[4];
            const threshold = parseInt(parts[5]);

            const member = await i.guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await i.reply({ content: "❌ Игрок не найден на сервере.", flags: MessageFlags.Ephemeral });
                return;
            }

            await member.roles.remove(fromRole).catch(() => null);
            await member.roles.add(toRole).catch(() => null);

            await saveDB(salary);

            const acceptEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Green")
                .setTitle(`✅ Повышение выдано | ${i.message.embeds[0].title?.split("|")[1]?.trim() || ""}`)
                .addFields({ name: "Повысил", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [acceptEmbed], components: [] });

            // Уведомляем игрока в канале уведомлений
            const notifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (notifChannel) {
                await notifChannel.send({
                    content: `🎉 <@${userId}>, поздравляем! Вам выдано повышение ранга. Баллы сброшены, продолжайте набирать!`
                }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // РАНГ КНОПКА — ОТКАЗАТЬ
        // =====================================================
        if (i.isButton() && i.customId.startsWith("rank_reject_")) {
            const parts = i.customId.split("_");
            // rank_reject_USERID_THRESHOLD
            const userId = parts[2];
            const threshold = parseInt(parts[3]);

            // Баллы не сбрасываем — игрок продолжает с текущим счётом

            const rejectEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Red")
                .setTitle(`❌ Повышение отклонено | ${i.message.embeds[0].title?.split("|")[1]?.trim() || ""}`)
                .addFields({ name: "Отклонил", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [rejectEmbed], components: [] });

            // Уведомляем игрока в ЛС
            const targetUser = await client.users.fetch(userId).catch(() => null);
            if (targetUser) {
                await targetUser.send(`❌ **Ваша заявка на повышение ранга была отклонена.**\nВаши баллы сброшены до **0**. Продолжайте набирать баллы для следующей попытки.`).catch(() => null);
            }
            return;
        }

        // =====================================================
        // РП ОТЧЁТ — меню при нажатии кнопки
        // =====================================================
        if (i.isButton() && i.customId === "interaction_rp_report") {
            const rpMenuEmbed = new EmbedBuilder()
                .setTitle("📋 РП отчёты и скрины ГГ, развоз грин")
                .setDescription(
                    "Отправляйте сюда свои РП отчёты и скрины ГГ, чтобы получать дополнительные баллы.\n\n" +
                    "• Одобренный **РП отчёт** даёт **+3 балла**.\n" +
                    "• Одобренный **Развоз грин** даёт **+1 балл**.\n" +
                    "• Одобренный **скрин ГГ** даёт **+1 балл**.\n\n" +
                    "Накопленные баллы вы можете тратить в семейном магазине: покупать товары или снимать выговоры через специальный товар."
                )
                .setColor("#2b2d31")
                .setThumbnail("https://cdn.discordapp.com/emojis/1516907994552602634.webp");

            const rpRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("rp_submit_report")
                    .setLabel("Подать РП отчёт")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("📋"),
                new ButtonBuilder()
                    .setCustomId("rp_submit_gg")
                    .setLabel("Скрин ГГ")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("🖼️"),
                new ButtonBuilder()
                    .setCustomId("rp_submit_green")
                    .setLabel("Развоз грин")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("🌿")
            );

            await i.reply({ embeds: [rpMenuEmbed], components: [rpRow], flags: MessageFlags.Ephemeral });
            rpMenuInteractions.set(i.user.id, i);
            setTimeout(() => deleteRpMenu(i.user.id), 120000);
            return;
        }

        // =====================================================
        // РП ОТЧЁТ — обработка подкнопок (подать отчёт / скрин гг / развоз грин)
        // =====================================================
        if (i.isButton() && (i.customId === "rp_submit_report" || i.customId === "rp_submit_gg" || i.customId === "rp_submit_green")) {
            const typeMap = {
                "rp_submit_report": { label: "РП отчёт", points: 3, emoji: "📋" },
                "rp_submit_gg":     { label: "Скрин ГГ", points: 1, emoji: "🖼️" },
                "rp_submit_green":  { label: "Развоз грин", points: 1, emoji: "🌿" }
            };
            const typeData = typeMap[i.customId];

            // Проверяем — нет ли уже ожидания от этого игрока
            const awaitRpKey = `rp_await_${i.user.id}`;
            if (applications.has(awaitRpKey)) {
                await i.reply({ content: "⏳ Вы уже отправили тип отчёта — пришлите скриншот в этот канал.", flags: MessageFlags.Ephemeral });
                return;
            }

            // Скрин ГГ и Развоз грин — без названия мероприятия, сразу просим скрин
            if (i.customId === "rp_submit_gg" || i.customId === "rp_submit_green") {
                await i.channel.permissionOverwrites.edit(i.user.id, {
                    SendMessages: true,
                    AttachFiles: true,
                    ViewChannel: true
                }).catch(() => null);

                applications.set(awaitRpKey, {
                    subType: i.customId,
                    label: typeData.label,
                    rpName: typeData.label,
                    points: typeData.points,
                    emoji: typeData.emoji,
                    channelId: i.channelId,
                    userId: i.user.id,
                    deletePrompt: () => i.deleteReply().catch(() => null),
                    deleteMenu: () => deleteRpMenu(i.user.id)
                });

                await i.reply({
                    content: `${typeData.emoji} **${typeData.label}**\n\n📎 Отправьте **фото или ссылку** на доказательство прямо в этот канал.\n⚠️ У вас есть **2 минуты**, иначе заявка отменится.`,
                    flags: MessageFlags.Ephemeral
                });
                scheduleEphemeralDelete(i);

                setTimeout(async () => {
                    if (applications.has(awaitRpKey)) {
                        applications.delete(awaitRpKey);
                        await i.channel.permissionOverwrites.delete(i.user.id).catch(() => null);
                        await i.channel.send({ content: `⏰ <@${i.user.id}>, время вышло! Скриншот не получен. Начните заново.` })
                            .then(m => setTimeout(() => m.delete().catch(() => null), 8000))
                            .catch(() => null);
                    }
                }, 120000);
                return;
            }

            // Показываем модалку для ввода названия мероприятия
            const nameModal = new ModalBuilder()
                .setCustomId(`rp_name_modal_${i.customId}`)
                .setTitle(`${typeData.label} — название`);

            const nameInput = new TextInputBuilder()
                .setCustomId("rp_name_input")
                .setLabel("Название РП мероприятия")
                .setPlaceholder("Например: Остров, Дроп, Цеха, Каптёрка...")
                .setRequired(true)
                .setMaxLength(80)
                .setStyle(TextInputStyle.Short);

            nameModal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            await i.showModal(nameModal);
            return;
        }

        // =====================================================
        // РП ОТЧЁТ — модалка с названием, затем ждём скрин
        // =====================================================
        if (i.isModalSubmit() && i.customId.startsWith("rp_name_modal_")) {
            const subType = i.customId.replace("rp_name_modal_", "");
            const typeMap = {
                "rp_submit_report": { label: "РП отчёт", points: 3, emoji: "📋" },
                "rp_submit_gg":     { label: "Скрин ГГ", points: 1, emoji: "🖼️" },
                "rp_submit_green":  { label: "Развоз грин", points: 1, emoji: "🌿" }
            };
            const typeData = typeMap[subType];
            const rpName = i.fields.getTextInputValue("rp_name_input");

            const awaitRpKey = `rp_await_${i.user.id}`;

            // Выдаём временный доступ на отправку файлов в этот канал
            await i.channel.permissionOverwrites.edit(i.user.id, {
                SendMessages: true,
                AttachFiles: true,
                ViewChannel: true
            }).catch(() => null);

            // Сохраняем в Map вместе с названием
            applications.set(awaitRpKey, {
                subType,
                label: typeData.label,
                rpName,
                points: typeData.points,
                emoji: typeData.emoji,
                channelId: i.channelId,
                userId: i.user.id,
                deletePrompt: () => i.deleteReply().catch(() => null),
                deleteMenu: () => deleteRpMenu(i.user.id)
            });

            await i.reply({
                content: `${typeData.emoji} **${typeData.label}** — \`${rpName}\`

📎 Теперь отправьте **фото или ссылку** на доказательство прямо в этот канал.
⚠️ У вас есть **2 минуты**, иначе заявка отменится.`,
                flags: MessageFlags.Ephemeral
            });
            scheduleEphemeralDelete(i);

            // Таймер
            setTimeout(async () => {
                if (applications.has(awaitRpKey)) {
                    applications.delete(awaitRpKey);
                    await i.channel.permissionOverwrites.delete(i.user.id).catch(() => null);
                    await i.channel.send({ content: `⏰ <@${i.user.id}>, время вышло! Скриншот не получен. Начните заново.` })
                        .then(m => setTimeout(() => m.delete().catch(() => null), 8000))
                        .catch(() => null);
                }
            }, 120000);
            return;
        }

        // =====================================================
        // РП ОТЧЁТ — одобрить / отклонить (модерация)
        // =====================================================
        if (i.isButton() && i.customId.startsWith("rp_accept_")) {
            const parts = i.customId.split("_");
            // формат: rp_accept_{subType}_{userId}_{points}_{encodedName}
            const encodedName = parts[parts.length - 1];
            const points = parseInt(parts[parts.length - 2]);
            const userId = parts[parts.length - 3];
            const subType = parts.slice(2, parts.length - 3).join("_");
            const typeMap = {
                "rp_submit_report": "РП отчёт",
                "rp_submit_gg":     "Скрин ГГ",
                "rp_submit_green":  "Развоз грин"
            };
            const label = typeMap[subType] || subType;

            // Декодируем название мероприятия
            let rpName = label;
            try { rpName = Buffer.from(encodedName, "base64").toString("utf-8"); } catch {}

            salary.mpPoints[userId] = (salary.mpPoints[userId] || 0) + points;

            // Записываем в историю
            if (!salary.mpHistory[userId]) salary.mpHistory[userId] = [];
            const reportNum = salary.mpHistory[userId].length + 1;
            const reviewMeta = reportReviewMeta.get(i.message.id) || {};
            const imgUrl = i.message.attachments?.first()?.url || reviewMeta.evidenceUrl || null;
            const imgName = i.message.attachments?.first()?.name || null;
            salary.mpHistory[userId].push({
                mp: rpName, result: "win", points,
                ts: Math.floor(Date.now() / 1000),
                imageUrl: imgUrl
            });
            await saveDB(salary);

            const acceptContainer = buildReportReviewContainer({
                userId,
                title: `<@${userId}>`,
                details: `**Статус:** ✅ ${label} одобрен\n**Принятый отчёт №:** ${reportNum}\n**Название:** ${rpName}\n**Начислено:** +${points}\n**Одобрил:** <@${i.user.id}>`,
                color: 0x2ECC71,
                evidenceUrl: imgUrl,
                attachmentName: imgName
            });
            await i.update({ components: [acceptContainer], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

            reportReviewMeta.delete(i.message.id);
            await sendPortfolioReportStatus(i.guild, userId, {
                status: "Принят",
                type: label,
                details: `**Отчёт №:** ${reportNum}\n**Название:** ${rpName}\n**Баллов:** +${points}\n**Одобрил:** <@${i.user.id}>`,
                evidenceUrl: imgUrl
            });

            // Уведомление в общий канал
            const notifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (notifChannel) {
                await notifChannel.send({
                    content: `✅ <@${userId}>, ваш **${label}** (${rpName}) одобрен! Начислено **+${points}** баллов. Всего: **${salary.mpPoints[userId]}**`
                }).catch(() => null);
            }
            return;
        }

        if (i.isButton() && i.customId.startsWith("rp_reject_")) {
            const userId = i.customId.replace("rp_reject_", "");

            const rejectContainer = buildReportReviewContainer({
                userId,
                title: `<@${userId}>`,
                details: `**Статус:** ❌ РП отчёт отклонён\n**Отклонил:** <@${i.user.id}>`,
                color: 0xE74C3C
            });
            await i.update({ components: [rejectContainer], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
            const rejectMeta = reportReviewMeta.get(i.message.id) || {};
            reportReviewMeta.delete(i.message.id);
            await sendPortfolioReportStatus(i.guild, userId, {
                status: "Отклонён",
                type: "РП отчёт",
                details: `**Отклонил:** <@${i.user.id}>`,
                evidenceUrl: rejectMeta.evidenceUrl || null
            });

            const notifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (notifChannel) {
                await notifChannel.send({
                    content: `❌ <@${userId}>, ваш отчёт был **отклонён**.`
                }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // ОТПУСК — долгосрочный АФК, ставится сразу по кнопке
        // =====================================================
        if (i.isButton() && i.customId === "interaction_vacation") {
            const vacationModal = new ModalBuilder()
                .setCustomId("vacation_enter_modal")
                .setTitle("Уход в отпуск");

            const reasonInput = new TextInputBuilder()
                .setCustomId("vacation_reason_input")
                .setLabel("Причина отпуска")
                .setPlaceholder("Учёба / работа / личные обстоятельства...")
                .setRequired(true)
                .setMaxLength(80)
                .setStyle(TextInputStyle.Short);

            const returnInput = new TextInputBuilder()
                .setCustomId("vacation_return_input")
                .setLabel("Дата возврата (ДД.ММ или ДД.ММ.ГГГГ)")
                .setPlaceholder("Например: 15.07 или 15.07.2026")
                .setRequired(false)
                .setMaxLength(10)
                .setStyle(TextInputStyle.Short);

            vacationModal.addComponents(
                new ActionRowBuilder().addComponents(reasonInput),
                new ActionRowBuilder().addComponents(returnInput)
            );

            await i.showModal(vacationModal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "vacation_enter_modal") {
            const reason = i.fields.getTextInputValue("vacation_reason_input") || "отпуск";
            const returnRaw = i.fields.getTextInputValue("vacation_return_input")?.trim() || "";

            let returnAt = null;

            if (returnRaw && /^\d{1,2}\.\d{1,2}(\.\d{2,4})?$/.test(returnRaw)) {
                const parts = returnRaw.split(".").map(Number);
                const [dd, mm] = parts;
                let yyyy = parts[2];
                const nowMsk = new Date(Date.now() + 3 * 60 * 60 * 1000);
                if (!yyyy) {
                    yyyy = nowMsk.getUTCFullYear();
                } else if (yyyy < 100) {
                    yyyy += 2000;
                }

                const MSK_OFFSET = 3 * 60 * 60 * 1000;
                const ret = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));
                returnAt = ret.getTime() - MSK_OFFSET;

                // Если дата уже прошла (без года) — берём следующий год
                if (!parts[2] && returnAt <= Date.now()) {
                    const retNext = new Date(Date.UTC(yyyy + 1, mm - 1, dd, 0, 0, 0));
                    returnAt = retNext.getTime() - MSK_OFFSET;
                }
            }

            salary.afk[i.user.id] = {
                reason: `🏖️ Отпуск: ${reason}`,
                returnAt,
                since: Date.now(),
                isVacation: true
            };
            await saveDB(salary);
            await updateAFKEmbed(i.guild);

            const returnText = returnAt
                ? `\n⏰ Ожидаемая дата возврата: <t:${Math.floor(returnAt / 1000)}:D>`
                : "";

            await i.reply({
                content: `🏖️ Вы ушли в **долгосрочный отпуск**.\n📝 Причина: **${reason}**${returnText}\n\nУведомления о сборах приостановлены до возвращения. Чтобы выйти из отпуска — нажмите «Вернулся из АФК» в АФК списке.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // =====================================================
        // ОТКАТ — гайд по оформлению + отправка отката на проверку
        // =====================================================
        if (i.isButton() && i.customId === "interaction_otkat") {
            const otkatEmbed = new EmbedBuilder()
                .setTitle("🎬 Гайд по оформлению отката")
                .setDescription(
                    "Для оформления отката необходимо записать видео по правилам семьи и прикрепить ссылку на него.\n\n" +
                    "**Требования к откату:**\n" +
                    "• Откат стрельбы — **от 5 минут**, капт или MCL.\n" +
                    "• Откат должен быть **не в виде мувика/нарезки** — цельная запись.\n" +
                    "• Загрузите видео на YouTube (можно с настройками «Доступ по ссылке») и приложите ссылку ниже.\n\n" +
                    "📺 [Гайд по записи отката на YouTube](https://www.youtube.com/results?search_query=как+записать+откат+gta)\n\n" +
                    "Нажмите кнопку ниже, чтобы отправить ссылку на ваш откат на проверку."
                )
                .setColor("#2b2d31")
                .setThumbnail("https://cdn.discordapp.com/emojis/1516907994552602634.webp");

            const otkatRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("otkat_submit")
                    .setLabel("Отправить откат")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("🎬")
            );

            await i.reply({ embeds: [otkatEmbed], components: [otkatRow], flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isButton() && i.customId === "otkat_submit") {
            const otkatModal = new ModalBuilder()
                .setCustomId("otkat_submit_modal")
                .setTitle("Отправка отката");

            const linkInput = new TextInputBuilder()
                .setCustomId("otkat_link_input")
                .setLabel("Ссылка на откат (YouTube)")
                .setPlaceholder("https://youtube.com/watch?v=...")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            otkatModal.addComponents(new ActionRowBuilder().addComponents(linkInput));
            await i.showModal(otkatModal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "otkat_submit_modal") {
            const otkatLink = i.fields.getTextInputValue("otkat_link_input")?.trim();

            const isValidLink = /^https?:\/\//i.test(otkatLink);
            if (!isValidLink) {
                await i.reply({ content: "❌ Укажите корректную ссылку (она должна начинаться с http:// или https://).", flags: MessageFlags.Ephemeral });
                return;
            }

            const reviewChannel = await client.channels.fetch(MP_REVIEW_CHANNEL).catch(() => null);

            const reviewRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`otkat_accept_${i.user.id}`)
                    .setLabel("✅ Принять")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`otkat_reject_${i.user.id}`)
                    .setLabel("❌ Отклонить")
                    .setStyle(ButtonStyle.Danger)
            );

            const submitContainer = buildReportReviewContainer({
                userId: i.user.id,
                title: `<@${i.user.id}>`,
                details: `**Статус:** На проверке\n**Тип:** Откат\n**Ссылка на доказательство:** ${otkatLink}`,
                color: 0x3498DB,
                evidenceUrl: otkatLink,
                buttons: reviewRow
            });

            if (reviewChannel) {
                const reviewMessage = await reviewChannel.send({
                    components: [submitContainer],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] }
                }).catch(() => null);
                if (reviewMessage) {
                    reportReviewLinks.set(reviewMessage.id, otkatLink);
                    reportReviewMeta.set(reviewMessage.id, { evidenceUrl: otkatLink, type: "Откат" });
                }
            }

            await i.reply({ content: "✅ Ваш откат отправлен на проверку администрации.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isButton() && i.customId.startsWith("otkat_accept_")) {
            const userId = i.customId.replace("otkat_accept_", "");

            const acceptContainer = buildReportReviewContainer({
                userId,
                title: `<@${userId}>`,
                details: `**Статус:** ✅ Откат принят\n**Принял:** <@${i.user.id}>`,
                color: 0x2ECC71
            });
            await i.update({ components: [acceptContainer], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

            const otkatMeta = reportReviewMeta.get(i.message.id) || {};
            reportReviewMeta.delete(i.message.id);
            reportReviewLinks.delete(i.message.id);
            await sendPortfolioReportStatus(i.guild, userId, {
                status: "Принят",
                type: "Откат",
                details: `**Ссылка:** ${otkatMeta.evidenceUrl || "—"}\n**Принял:** <@${i.user.id}>`,
                evidenceUrl: otkatMeta.evidenceUrl || null
            });
            return;
        }

        if (i.isButton() && i.customId.startsWith("otkat_reject_")) {
            const userId = i.customId.replace("otkat_reject_", "");

            const rejectContainer = buildReportReviewContainer({
                userId,
                title: `<@${userId}>`,
                details: `**Статус:** ❌ Откат отклонён\n**Отклонил:** <@${i.user.id}>`,
                color: 0xE74C3C
            });
            await i.update({ components: [rejectContainer], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
            const rejectMeta = reportReviewMeta.get(i.message.id) || {};
            reportReviewMeta.delete(i.message.id);
            reportReviewLinks.delete(i.message.id);
            await sendPortfolioReportStatus(i.guild, userId, {
                status: "Отклонён",
                type: "Откат",
                details: `**Отклонил:** <@${i.user.id}>`,
                evidenceUrl: rejectMeta.evidenceUrl || null
            });

            const notifChannel = await client.channels.fetch(MP_REJECTED_CHANNEL).catch(() => null);
            if (notifChannel) {
                await notifChannel.send({ content: `❌ <@${userId}>, ваш **откат** был отклонён.` }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // АДМИН-ПАНЕЛЬ ПОРТФЕЛЯ — управление тиром
        // =====================================================
        if (i.isButton() && (i.customId.startsWith("portfolio_thread_tier_up_") || i.customId.startsWith("portfolio_thread_tier_down_"))) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (!hasPortfolioAdminAccess(i)) {
                await i.editReply({ content: "❌ У вас нет доступа к управлению тирами." });
                return;
            }

            const isUp = i.customId.startsWith("portfolio_thread_tier_up_");
            const prefix = isUp ? "portfolio_thread_tier_up_" : "portfolio_thread_tier_down_";
            const userId = i.customId.replace(prefix, "");
            const member = await i.guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await i.editReply({ content: "❌ Пользователь не найден на сервере." });
                return;
            }

            const currentTier = member.roles.cache.has(PORTFOLIO_TIER_A_ROLE_ID)
                ? "A"
                : member.roles.cache.has(PORTFOLIO_TIER_B_ROLE_ID)
                    ? "B"
                    : member.roles.cache.has(PORTFOLIO_TIER_C_ROLE_ID)
                        ? "C"
                        : "none";
            const nextTier = isUp
                ? ({ none: "C", C: "B", B: "A", A: null }[currentTier])
                : ({ A: "B", B: "C", C: "none", none: null }[currentTier]);

            if (!nextTier) {
                await i.editReply({
                    content: isUp
                        ? "ℹ️ У пользователя уже максимальный тир A."
                        : "ℹ️ У пользователя уже нет минимального тира C."
                });
                return;
            }

            await member.roles.remove(PORTFOLIO_TIER_ROLE_IDS).catch(() => null);
            const nextRole = {
                A: PORTFOLIO_TIER_A_ROLE_ID,
                B: PORTFOLIO_TIER_B_ROLE_ID,
                C: PORTFOLIO_TIER_C_ROLE_ID
            }[nextTier];
            if (nextRole) await member.roles.add(nextRole).catch(() => null);

            const tierLabel = nextTier === "none" ? "без тира" : `тир ${nextTier}`;
            await i.editReply({ content: `✅ Для <@${userId}> установлен **${tierLabel}**.` });
            return;
        }

        // =====================================================
        // КОМАНДА — призвать админ-панель портфеля
        // =====================================================
        if (i.commandName === "portfolio_panel") {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (!hasPortfolioAdminAccess(i)) {
                await i.editReply({ content: "❌ У вас нет доступа к админ-панели портфелей." });
                return;
            }

            const selectedUser = i.options.getUser("user");
            let userId = selectedUser?.id || null;
            let portfolioChannel = userId
                ? await findPersonalReportChannel(i.guild, userId, true)
                : null;

            if (!portfolioChannel && i.channel?.topic) {
                userId = extractPortfolioUserId(i.channel.topic);
                portfolioChannel = userId ? i.channel : null;
            }
            if (!portfolioChannel && i.channel?.parentId) {
                const parentChannel = await i.guild.channels.fetch(i.channel.parentId).catch(() => null);
                userId = extractPortfolioUserId(parentChannel?.topic);
                portfolioChannel = userId ? parentChannel : null;
            }

            if (!portfolioChannel || !userId) {
                await i.editReply({ content: "❌ Укажите пользователя: `/portfolio_panel user:@пользователь`." });
                return;
            }

            const member = await i.guild.members.fetch(userId).catch(() => null);
            const thread = member ? await ensurePortfolioAdminThread(member, portfolioChannel) : null;
            if (!thread) {
                await i.editReply({ content: "❌ Не удалось создать или найти админ-ветку портфеля." });
                return;
            }

            await thread.send({
                components: [buildPortfolioAdminThreadContainer(userId, portfolioBaseChannelName(member))],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] }
            }).catch(() => null);
            await i.editReply({ content: `✅ Админ-панель призвана в ветке ${thread}.` });
            return;
        }

        // =====================================================
        // НАЧИСЛЕНИЕ БАЛЛОВ ИЗ ПРИВАТНОЙ ВЕТКИ ПОРТФЕЛЯ
        // =====================================================
        if (i.isButton() && (i.customId.startsWith("portfolio_thread_reward_rp_") || i.customId.startsWith("portfolio_thread_reward_capt_"))) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (!hasPortfolioAdminAccess(i)) {
                await i.editReply({ content: "❌ У вас нет доступа к управлению портфелями." });
                return;
            }

            const isCapt = i.customId.startsWith("portfolio_thread_reward_capt_");
            const prefix = isCapt ? "portfolio_thread_reward_capt_" : "portfolio_thread_reward_rp_";
            const userId = i.customId.replace(prefix, "");
            const points = isCapt ? PORTFOLIO_REWARD_CAPT_POINTS : PORTFOLIO_REWARD_RP_POINTS;
            const reason = isCapt ? "Капт" : "РП отчёт";
            const targetMember = await i.guild.members.fetch(userId).catch(() => null);
            if (!targetMember) {
                await i.editReply({ content: "❌ Владелец портфеля не найден на сервере." });
                return;
            }

            salary.mpPoints[userId] = (salary.mpPoints[userId] || 0) + points;
            salary.portfolioHistory[userId] ||= [];
            salary.portfolioHistory[userId].push({
                points,
                reason,
                by: i.user.id,
                ts: Math.floor(Date.now() / 1000)
            });
            await saveDB(salary);
            await i.editReply({
                content: `✅ Владельцу портфеля <@${userId}> начислено **+${points}** ${points === 1 ? "балл" : "балла"} за **${reason}**.\\nВсего МП-баллов: **${fmtPoints(salary.mpPoints[userId])}**`
            });
            return;
        }

        // =====================================================
        // ПОРТФЕЛЬ — создать приватный канал для игрока
        // =====================================================
        if (i.isButton() && i.customId === "interaction_portfolio") {
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            const member = await i.guild.members.fetch(i.user.id).catch(() => null);
            const result = member ? await ensurePrivatePortfolioChannel(member) : null;
            const portfolioChannel = result?.channel || null;

            if (!portfolioChannel) {
                await i.editReply({ content: "❌ Не удалось создать портфель. Проверьте права бота и наличие категории портфелей." });
                return;
            }

            if (result.created) {
                const curatorId = salary.recruits[i.user.id] || null;
                const curatorText = curatorId ? `<@${curatorId}>` : "Не назначен";
                const portfolioEmbed = new EmbedBuilder()
                    .setTitle("💼 Личный портфель")
                    .setThumbnail(i.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `**Владелец:** <@${i.user.id}>\n` +
                        `**Куратор:** ${curatorText}\n` +
                        `**Дата создания:** ${new Date().toLocaleDateString("ru-RU")}`
                    )
                    .setColor("#2b2d31")
                    .setTimestamp();

                await portfolioChannel.send({ embeds: [portfolioEmbed] }).catch(() => null);
            }

            const openPortfolioRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel("Открыть портфель")
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/channels/${i.guild.id}/${portfolioChannel.id}`)
            );
            await i.editReply({
                content: `✅ Ваш портфель готов: ${portfolioChannel}`,
                components: [openPortfolioRow]
            });
            return;
        }

        if (i.isButton() && i.customId.startsWith("view_archive_app_")) {
            const tId = i.customId.replace("view_archive_app_", "");
            const arch = salary.archive[tId];
            if (!arch || !arch.fields) {
                return i.reply({ content: "❌ Анкета не найдена в базе данных.", flags: MessageFlags.Ephemeral });
            }

            const appEmbed = new EmbedBuilder()
                .setTitle(`Архивная заявка от пользователя`)
                .setDescription(`**Статик и Никнейм:** ${arch.fields.q1}\n\n**Имя и Возраст:** ${arch.fields.q2}\n\n**Опыт:** ${arch.fields.q3}\n\n**Почему именно мы:** ${arch.fields.q4}${arch.fields.q5 ? `\n\n**Откаты:** ${arch.fields.q5}` : ""}`)
                .setColor("#1f8b4c");

            await i.reply({ embeds: [appEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // =====================================================
        // МАГАЗИН — кнопка "Баланс"
        // =====================================================
        if (i.isButton() && i.customId === "shop_balance") {
            const currentPoints = salary.mpPoints[i.user.id] || 0;
            await i.reply({ content: `🏆 Баланс баллов: \`${fmtPoints(currentPoints)}\``, flags: MessageFlags.Ephemeral });
            return;
        }

        // =====================================================
        // МАГАЗИН — покупка "Снять выговор" (50 баллов)
        // =====================================================
        if (i.isButton() && i.customId === "shop_buy_warn") {
            const price = 50;
            const currentPoints = salary.mpPoints[i.user.id] || 0;

            if (currentPoints < price) {
                await i.reply({ content: `❌ Недостаточно баллов. Нужно **${price}**, у вас **${fmtPoints(currentPoints)}**.`, flags: MessageFlags.Ephemeral });
                return;
            }

            salary.mpPoints[i.user.id] = currentPoints - price;
            await saveDB(salary);

            await i.reply({ content: `✅ Покупка оформлена: **Снять выговор**. Списано **${price}** баллов. Остаток: **${fmtPoints(salary.mpPoints[i.user.id])}**.\n⚠️ Заявка отправлена администрации на подтверждение.`, flags: MessageFlags.Ephemeral });

            const reviewChannel = await client.channels.fetch(WARN_PURCHASE_CHANNEL).catch(() => null);
            if (reviewChannel) {
                const warnEmbed = new EmbedBuilder()
                    .setTitle("⚠️ Покупка: Снять выговор")
                    .setThumbnail(i.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `👤 **Игрок:** <@${i.user.id}>\n` +
                        `🛒 **Товар:** Снять выговор\n` +
                        `🏆 **Списано баллов:** ${price}\n` +
                        `📦 **Остаток баллов:** ${fmtPoints(salary.mpPoints[i.user.id])}`
                    )
                    .setColor("Orange")
                    .setTimestamp();

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`warn_purchase_confirm_${i.user.id}`)
                        .setLabel("Подтвердить")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("✅")
                );

                await reviewChannel.send({ embeds: [warnEmbed], components: [confirmRow] }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // МАГАЗИН — подтверждение администратором снятия выговора
        // =====================================================
        if (i.isButton() && i.customId.startsWith("warn_purchase_confirm_")) {
            const userId = i.customId.replace("warn_purchase_confirm_", "");

            const confirmedEmbed = EmbedBuilder.from(i.message.embeds[0])
                .setColor("Green")
                .setTitle("✅ Снят выговор | Подтверждено")
                .addFields({ name: "Подтвердил", value: `<@${i.user.id}>`, inline: true });

            await i.update({ embeds: [confirmedEmbed], components: [] });

            // Записываем в портфель игрока, если он у него есть
            const portfolioChannel = await findPersonalReportChannel(i.guild, userId, true);
            if (portfolioChannel) {
                const nowStr = new Date().toLocaleDateString("ru-RU") + " " + new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                const portfolioEmbed = new EmbedBuilder()
                    .setTitle("⚠️ Снятие выговора • ✅ Подтверждено")
                    .setDescription(
                        `**Товар:** Снять выговор\n` +
                        `**Подтвердил:** <@${i.user.id}>\n` +
                        `**Дата:** ${nowStr}`
                    )
                    .setColor("Green")
                    .setTimestamp();
                await portfolioChannel.send({ embeds: [portfolioEmbed] }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // МАГАЗИН — покупка "100,000 игровой валюты" (1000 баллов)
        // =====================================================
        if (i.isButton() && i.customId === "shop_buy_cash") {
            const price = 100;
            const currentPoints = salary.mpPoints[i.user.id] || 0;

            if (currentPoints < price) {
                await i.reply({ content: `❌ Недостаточно баллов. Нужно **${price}**, у вас **${fmtPoints(currentPoints)}**.`, flags: MessageFlags.Ephemeral });
                return;
            }

            salary.mpPoints[i.user.id] = currentPoints - price;
            await saveDB(salary);

            await i.reply({ content: `✅ Покупка оформлена: **100,000 игровой валюты**. Списано **${price}** баллов. Остаток: **${fmtPoints(salary.mpPoints[i.user.id])}**.\n💵 Обратитесь к администрации для ручной выдачи.`, flags: MessageFlags.Ephemeral });

            const logChannel = await i.guild.channels.fetch("1518544382985371698").catch(() => null);
            if (logChannel) {
                await logChannel.send({ content: `🛒 <@${i.user.id}> купил(а) **«100,000 игровой валюты»** за **${price}** баллов. Требуется ручная выдача администрацией.` }).catch(() => null);
            }
            return;
        }

        // =====================================================
        // МАГАЗИН — покупка повышения до роли "main" (500 баллов)
        // =====================================================
        if (i.isButton() && i.customId === "shop_buy_main") {
            const price = 500;
            const MAIN_ROLE_ID = "1458485277495656553";
            const currentPoints = salary.mpPoints[i.user.id] || 0;

            if (currentPoints < price) {
                await i.reply({ content: `❌ Недостаточно баллов. Нужно **${price}**, у вас **${fmtPoints(currentPoints)}**.`, flags: MessageFlags.Ephemeral });
                return;
            }

            const member = await i.guild.members.fetch(i.user.id).catch(() => null);
            if (!member) {
                await i.reply({ content: "❌ Не удалось найти вас на сервере.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (member.roles.cache.has(MAIN_ROLE_ID)) {
                await i.reply({ content: "❌ У вас уже есть роль `main`.", flags: MessageFlags.Ephemeral });
                return;
            }

            const roleAdded = await member.roles.add(MAIN_ROLE_ID).then(() => true).catch(() => false);
            if (!roleAdded) {
                await i.reply({ content: "❌ Не удалось выдать роль. Проверьте права бота и иерархию ролей.", flags: MessageFlags.Ephemeral });
                return;
            }

            salary.mpPoints[i.user.id] = currentPoints - price;
            await saveDB(salary);

            await i.reply({ content: `✅ Покупка оформлена: повышение до роли **main**. Списано **${price}** баллов. Остаток: **${fmtPoints(salary.mpPoints[i.user.id])}**.\n📈 Роль <@&${MAIN_ROLE_ID}> выдана автоматически.`, flags: MessageFlags.Ephemeral });

            const logChannel = await i.guild.channels.fetch("1518544382985371698").catch(() => null);
            if (logChannel) {
                await logChannel.send({ content: `🛒 <@${i.user.id}> купил(а) повышение **«main»** за **${price}** баллов. Роль выдана автоматически.` }).catch(() => null);
            }
            return;
        }

        if (i.isButton() && (i.customId === "afk_enter" || i.customId === "afk_leave")) {
            if (i.customId === "afk_enter") {
                // Показываем модалку для ввода причины и времени возврата
                const afkModal = new ModalBuilder()
                    .setCustomId("afk_enter_modal")
                    .setTitle("Уход в АФК");

                const reasonInput = new TextInputBuilder()
                    .setCustomId("afk_reason_input")
                    .setLabel("Причина АФК")
                    .setPlaceholder("дела / сон / еда / афк...")
                    .setRequired(true)
                    .setMaxLength(60)
                    .setStyle(TextInputStyle.Short);

                const returnInput = new TextInputBuilder()
                    .setCustomId("afk_return_input")
                    .setLabel("Вернусь через (минут) или время HH:MM")
                    .setPlaceholder("Например: 30 или 14:30")
                    .setRequired(false)
                    .setMaxLength(10)
                    .setStyle(TextInputStyle.Short);

                afkModal.addComponents(
                    new ActionRowBuilder().addComponents(reasonInput),
                    new ActionRowBuilder().addComponents(returnInput)
                );

                await i.showModal(afkModal);
            } else {
                if (salary.afk[i.user.id]) {
                    const afkData = salary.afk[i.user.id];
                    delete salary.afk[i.user.id];
                    await saveDB(salary);
                    await sendForumLog(i.guild, "afkLeave", [
                        `**Участник:** <@${i.user.id}>`,
                        `**Причина AFK:** ${clipLogText(afkData?.reason || "афк")}`,
                        `**Кто снял статус:** <@${i.user.id}>`
                    ]);
                }
                await i.reply({ content: "🏃 Вы вернулись из АФК! Уведомления о сборах возобновлены.", flags: MessageFlags.Ephemeral });
                await updateAFKEmbed(i.guild);
            }
            return;
        }

        // =====================================================
        // АФК МОДАЛКА — обработка причины и времени возврата
        // =====================================================
        if (i.isModalSubmit() && i.customId === "afk_enter_modal") {
            const reason = i.fields.getTextInputValue("afk_reason_input") || "афк";
            const returnRaw = i.fields.getTextInputValue("afk_return_input")?.trim() || "";

            let returnAt = null;

            if (returnRaw) {
                // Если формат "HH:MM" — трактуем как МСК (UTC+3)
                if (/^\d{1,2}:\d{2}$/.test(returnRaw)) {
                    const [hh, mm] = returnRaw.split(":").map(Number);
                    const nowUtc = Date.now();
                    const MSK_OFFSET = 3 * 60 * 60 * 1000; // UTC+3
                    // Текущее время в МСК
                    const nowMsk = new Date(nowUtc + MSK_OFFSET);
                    // Строим целевое время в МСК (как UTC дату со смещением)
                    const ret = new Date(nowMsk);
                    ret.setUTCHours(hh, mm, 0, 0);
                    // Если время уже прошло сегодня по МСК — завтра
                    if (ret.getTime() <= nowMsk.getTime()) ret.setUTCDate(ret.getUTCDate() + 1);
                    // Переводим обратно в реальный UTC timestamp
                    returnAt = ret.getTime() - MSK_OFFSET;
                } else if (/^\d+$/.test(returnRaw)) {
                    // Число минут — просто прибавляем
                    returnAt = Date.now() + parseInt(returnRaw) * 60 * 1000;
                }
            }

            salary.afk[i.user.id] = { reason, returnAt, since: Date.now() };
            await saveDB(salary);
            await updateAFKEmbed(i.guild);

            const returnText = returnAt
                ? `\n⏰ Ожидаемый возврат: <t:${Math.floor(returnAt / 1000)}:T>`
                : "";

            await i.reply({
                content: `💤 Вы ушли в АФК.\n📝 Причина: **${reason}**${returnText}\n\nУведомления о сборах приостановлены.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (i.isButton() && i.customId === "open_report_modal") {
            const modal = new ModalBuilder()
                .setCustomId("modal_report_submit")
                .setTitle("Подача отчета на повышение");

            const staticInput = new TextInputBuilder()
                .setCustomId("report_static_id")
                .setLabel("СТАТИК ИГРОВОГО ПЕРСОНАЖА (ТОЛЬКО ЦИФРЫ)")
                .setPlaceholder("Пример: 21074")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            const linkInput = new TextInputBuilder()
                .setCustomId("report_proof_link")
                .setLabel("ССЫЛКА НА ДОКАЗАТЕЛЬСТВА (IMGUR И Т.Д.)")
                .setPlaceholder("https://imgur.com/...")
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            modal.addComponents(
                new ActionRowBuilder().addComponents(staticInput),
                new ActionRowBuilder().addComponents(linkInput)
            );

            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId === "modal_report_submit") {
            const staticIdStr = i.fields.getTextInputValue("report_static_id");
            const proofLink = i.fields.getTextInputValue("report_proof_link");

            if (!/^\d+$/.test(staticIdStr)) {
                await i.reply({ content: "❌ Ошибка: В строке статического ID должны быть только цифры!", flags: MessageFlags.Ephemeral });
                return;
            }

            await i.guild.channels.fetch().catch(() => null);
            const reportCategory = config.CHANNELS.REPORT_CATEGORY || config.CHANNELS.CATEGORY;

            const reportChannel = await i.guild.channels.create({
                name: `report-${i.user.username}`,
                type: ChannelType.GuildText,
                parent: reportCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] }))
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle("📑 Новый отчет на повышение")
                .setDescription(`👤 **Отправитель:** <@${i.user.id}>\n🆔 **Статик:** \`${staticIdStr}\`\n🔗 **Доказательства:** ${proofLink}`)
                .setColor("#2b2d31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`report_accept_${i.user.id}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`report_reject_${i.user.id}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
            );

            await reportChannel.send({ embeds: [embed], components: [row] });
            await i.reply({ content: `✅ Ваш отчет отправлен! Создан тикет проверки: <#${reportChannel.id}>`, flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isButton() && i.customId.startsWith("report_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) {
                return i.reply({ content: "❌ У вас нет прав для проверки отчетов.", flags: MessageFlags.Ephemeral });
            }

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "reject") {
                if (targetMember) {
                    await targetMember.send("❌ Ваш отчет на повышение был проверен и отклонен администрацией.").catch(() => null);
                }
                await i.reply({ content: "❌ Отчет отклонен. Тикет закрывается..." });
                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }

            if (action === "accept") {
                salary.reports[targetId] = (salary.reports[targetId] || 0) + 1;
                await saveDB(salary);

                await i.reply({ content: "✅ Отчет успешно зафиксирован!" });

                const currentCount = salary.reports[targetId];
                let triggerPromo = false;
                let fromRankName = "", toRankName = "", removeRoleId = "", addRoleId = "";

                if (targetMember) {
                    if (targetMember.roles.cache.has("1513647909965533377") && currentCount >= 5) {
                        triggerPromo = true; fromRankName = "TEST"; toRankName = "Academy"; removeRoleId = "1513647909965533377"; addRoleId = "1458485405769797848";
                    } else if (targetMember.roles.cache.has("1458485405769797848") && currentCount >= 10) {
                        triggerPromo = true; fromRankName = "Academy"; toRankName = "Young"; removeRoleId = "1458485405769797848"; addRoleId = "1458485351424331903";
                    } else if (targetMember.roles.cache.has("1458485351424331903") && currentCount >= 20) {
                        triggerPromo = true; fromRankName = "Young"; toRankName = "Darkness"; removeRoleId = "1458485351424331903"; addRoleId = "1458485277495656553";
                    }
                }

                if (triggerPromo) {
                    const notifyChannel = await i.guild.channels.fetch(config.CHANNELS.NOTIFY_PROMO).catch(() => null);
                    if (notifyChannel) {
                        const promoEmbed = new EmbedBuilder()
                            .setTitle("📈 Заявка на утверждение повышения")
                            .setDescription(`👤 Игрок <@${targetId}> успешно выполнил требования по количеству отчетов (**${currentCount} шт.**).\nПожалуйста, подтвердите его повышение в планшете с **${fromRankName}** до **${toRankName}**.`)
                            .setColor("Purple");

                        const promoRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`p_confirm_${targetId}_${removeRoleId}_${addRoleId}`).setLabel("Принять").setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`p_deny_${targetId}`).setLabel("Отказать").setStyle(ButtonStyle.Danger)
                        );

                        await notifyChannel.send({ embeds: [promoEmbed], components: [promoRow] });
                    }
                }

                setTimeout(() => i.channel.delete().catch(() => null), 2000);
                return;
            }
        }

        if (i.isButton() && i.customId.startsWith("p_")) {
            const parts = i.customId.split("_");
            const action = parts[1];
            const targetId = parts[2];

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => i.member.roles.cache.has(role));
            if (!hasPermission) {
                return i.reply({ content: "❌ У вас нет прав для утверждения рангов.", flags: MessageFlags.Ephemeral });
            }

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

            if (action === "deny") {
                if (targetMember) {
                    await targetMember.send("❌ Ваше ручное повышение в планшете было отклонено старшим составом.").catch(() => null);
                }
                await i.reply({ content: "❌ Повышение отклонено.", flags: MessageFlags.Ephemeral });
                await i.message.delete().catch(() => null);
                return;
            }

            if (action === "confirm") {
                const remRole = parts[3];
                const addRole = parts[4];

                if (targetMember) {
                    if (remRole) await targetMember.roles.remove(remRole).catch(() => null);
                    if (addRole) await targetMember.roles.add(addRole).catch(() => null);
                    await targetMember.send(`🎉 Поздравляем! Ваш ранг на сервере был успешно обновлен!`).catch(() => null);
                }

                await i.reply({ content: "✅ Роли игрока перевыданы, повышение зафиксировано!", flags: MessageFlags.Ephemeral });
                await i.message.delete().catch(() => null);
                return;
            }
        }

        if (i.isButton() && i.customId.startsWith("group_start_")) {
            const faction = i.customId.replace("group_start_", "");
            
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`group_select_${faction}`)
                    .setPlaceholder("Выберите тип мероприятие")
            );

            if (faction === "ballas") {
                menu.components[0].addOptions(
                    { label: "Цеха", value: "цеха" }, { label: "Диллеры", value: "диллеры" },
                    { label: "Остров", value: "остров" }, { label: "Поставки", value: "поставки" },
                    { label: "ФЗ", value: "фз" }, { label: "Контент", value: "контент" },
                    { label: "Банк", value: "банк" }, { label: "Дроп", value: "дроп" }
                );
            } else {
                menu.components[0].addOptions(
                    { label: "Капты", value: "капты" }, { label: "Контент", value: "контент" },
                    { label: "Арену", value: "арену" }, { label: "Тайники", value: "тайники" }
                );
            }

            await i.reply({ content: "Выберите тип сбора из списка ниже:", components: [menu], flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isStringSelectMenu() && i.customId.startsWith("group_select_")) {
            const faction = i.customId.replace("group_select_", "");
            const activity = i.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`group_modal_code_${faction}_${activity}`)
                .setTitle("Код группы");

            const codeInput = new TextInputBuilder()
                .setCustomId("group_code_input")
                .setLabel("Введите код группы из 5 символов")
                .setPlaceholder("Например: YFKVQ")
                .setMinLength(5)
                .setMaxLength(5)
                .setRequired(true)
                .setStyle(TextInputStyle.Short);

            modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("group_modal_code_")) {
            const parts = i.customId.split("_");
            const faction = parts[3];   
            const activity = parts[4];  

            const code = i.fields.getTextInputValue("group_code_input").toUpperCase();
            const guildId = faction === "ballas" ? "1504470399268819115" : "1458190222042075251";

            const controlEmbed = new EmbedBuilder()
                .setTitle("⚙️ Панель ручного управления сбором")
                .setDescription(`**Фракция:** ${faction.toUpperCase()}\n**Мероприятие:** ${activity}\n**Код группы:** \`${code}\`\n\nИспользуйте кнопки ниже для рассылки. Кнопку в канал можно нажимать много раз для спама.`)
                .setColor("Yellow");

            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`sbor_channel_${guildId}_${activity}_${code}`)
                    .setLabel("Отправить в канал")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("📣"),
                new ButtonBuilder()
                    .setCustomId(`sbor_dms_${guildId}_${activity}_${code}`)
                    .setLabel("Отправить в ЛС")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("📩"),
                new ButtonBuilder()
                    .setCustomId("sbor_cancel")
                    .setLabel("Отменить / Скрыть")
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji("❌")
            );

            await i.reply({ embeds: [controlEmbed], components: [controlRow], flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isButton() && i.customId.startsWith("sbor_")) {
            if (i.customId === "sbor_cancel") {
                await i.update({ content: "✅ Панель управления сбором закрыта.", embeds: [], components: [] });
                return;
            }

            const parts = i.customId.split("_");
            const action = parts[1];
            const guildId = parts[2];
            const activity = parts[3];
            const code = parts[4];

            const targetConfig = SERVERS[guildId];
            if (!targetConfig) return;

            const targetGuild = await client.guilds.fetch(guildId).catch(() => null);
            if (!targetGuild) return;

            const pingString = `@everyone ${targetConfig.PING_ROLES.map(r => `<@&${r}>`).join(" ")}`;
            const messageContent = `${pingString}\n\n## Сбор на ${activity}, всем быть, кого не будет = 2 варна. Группа: ${code} ##`;

            if (action === "channel") {
                const targetChannel = await targetGuild.channels.fetch(targetConfig.CHANNELS.SBOR).catch(() => null);
                if (targetChannel) {
                    await targetChannel.send(messageContent).catch(() => null);
                    await i.reply({ content: "✅ 1 сообщение успешно отправлено в канал сбора!", flags: MessageFlags.Ephemeral });
                } else {
                    await i.reply({ content: "❌ Ошибка: канал сбора не найден на сервере.", flags: MessageFlags.Ephemeral });
                }
            } else if (action === "dms") {
                await i.reply({ content: "⏳ Начинаю рассылку в ЛС (может занять время)...", flags: MessageFlags.Ephemeral });
                try {
                    await targetGuild.members.fetch();
                    const targetMembers = targetGuild.members.cache.filter(m => 
                        targetConfig.PING_ROLES.some(roleId => m.roles.cache.has(roleId)) && !m.user.bot && !salary.afk[m.id]
                    );

                    let successCount = 0;
                    for (const [id, member] of targetMembers) {
                        try {
                            await member.send(`🔔 **Внимание!**\n${messageContent}`);
                            successCount++;
                        } catch (e) {}
                    }
                    await i.editReply({ content: `✅ Рассылка завершена! Доставлено: ${successCount} сообщений.` });
                } catch (e) {
                    await i.editReply({ content: "❌ Произошла ошибка при попытке рассылки в ЛС." });
                }
            }
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("app_reject_modal_")) {
            const targetId = i.customId.replace("app_reject_modal_", "");
            const reason = i.fields.getTextInputValue("reject_reason_input");

            const isMainCh = i.channel.name.startsWith("main");
            const isRecruitCh = i.channel.name.startsWith("recruit");
            const logChannelId = isMainCh
                ? (config.CHANNELS.AUDIT_MAIN || config.CHANNELS.AUDIT_APP)
                : isRecruitCh
                    ? (config.CHANNELS.AUDIT_RECRUIT || config.CHANNELS.AUDIT_APP)
                    : (config.CHANNELS.AUDIT_APP || "1464575195418460417");
            const logChannel = await i.guild.channels.fetch(logChannelId).catch(() => null);
            const rejectData = applications.get(targetId);
            const rejectType = rejectData?.type || appTypeFromChannelName(i.channel.name);
            await sendApplicationAudit(i.guild, {
                status: "Отказана",
                data: rejectData,
                type: rejectType,
                targetId,
                username: i.user.username,
                channelId: i.channel.id,
                actorId: i.user.id,
                reason
            });

            if (logChannel) {
                const appData = applications.get(targetId);
                const appType = appData?.type || appTypeFromChannelName(i.channel.name);

                if (isRecruitCh) {
                    await logChannel.send({
                        components: [buildDirectApplicationAuditContainer({
                            status: "Отказана",
                            data: appData,
                            type: appType,
                            targetId,
                            username: i.user.username,
                            channelId: i.channel.id,
                            actorId: i.user.id,
                            reason
                        })],
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [] }
                    }).catch(() => null);
                } else {
                    const rejectEmbed = new EmbedBuilder()
                        .setTitle(`❌ Заявка отклонена | ${isMainCh ? "Main состав" : "Семья"}`)
                        .setColor("Red")
                        .setDescription(buildAppBodyText(appType, appData))
                        .addFields(
                            { name: "Кого", value: `<@${targetId}>`, inline: true },
                            { name: "Отклонил", value: `<@${i.user.id}>`, inline: true },
                            { name: "Причина", value: reason, inline: false }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [rejectEmbed] }).catch(() => null);
                }
            }

            ticketReviewers.delete(i.channel.id);
            await i.reply({ content: `❌ Заявка успешно отклонена. Причина зафиксирована в канале логирования.` }).catch(() => null);
            setTimeout(() => i.channel.delete().catch(() => null), 2000);
            return;
        }

        if (!config) return;

        if (i.isButton() && i.customId.startsWith("plus_")) {
            const [, action, eventId] = i.customId.split("_");
            const event = plusEvents.get(eventId);
            if (!event || event.guildId !== i.guild.id) {
                await i.reply({ content: "❌ Этот сбор плюсов больше не найден или бот был перезапущен.", flags: MessageFlags.Ephemeral });
                return;
            }

            const userId = i.user.id;
            const inRegular = event.participants.has(userId);
            const inExtra = event.extraParticipants.has(userId);
            const occupied = plusTotalSlots(event);

            if (action === "join") {
                if (inRegular) {
                    await i.reply({ content: "ℹ️ Вы уже находитесь в обычных слотах.", flags: MessageFlags.Ephemeral });
                    return;
                }
                if (inExtra) {
                    // Перемещение из дополнительных слотов в обычные.
                    event.extraParticipants.delete(userId);
                    event.participants.set(userId, { userId });
                } else {
                    if (occupied >= event.slots) {
                        await i.reply({ content: "❌ Все слоты уже заняты.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    event.participants.set(userId, { userId });
                }
            } else if (action === "leave") {
                if (!inRegular && !inExtra) {
                    await i.reply({ content: "ℹ️ Вы ещё не присоединились к этому сбору.", flags: MessageFlags.Ephemeral });
                    return;
                }
                event.participants.delete(userId);
                event.extraParticipants.delete(userId);
            } else if (action === "extra") {
                if (inExtra) {
                    await i.reply({ content: "ℹ️ Вы уже находитесь в дополнительных слотах.", flags: MessageFlags.Ephemeral });
                    return;
                }
                if (inRegular) {
                    // Перемещение из обычных слотов в дополнительные без увеличения общего счётчика.
                    event.participants.delete(userId);
                    event.extraParticipants.set(userId, { userId });
                } else {
                    if (occupied >= event.slots) {
                        await i.reply({ content: "❌ Свободных слотов больше нет.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    event.extraParticipants.set(userId, { userId });
                }
            } else {
                return;
            }

            await i.update({
                components: [buildPlusContainer(event)],
                flags: MessageFlags.IsComponentsV2
            });
            return;
        }

        if (i.isButton() && i.customId === "open_main_modal") {
            const type = "main";
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle("Заявка в Main");

            const fields = [
                { id: "q1", label: "Ваш статик", placeholder: "21074", style: TextInputStyle.Short },
                { id: "q5", label: "Предоставьте ваши откаты", placeholder: "Откат стрельбы от 5 минут с GG или с МП/капта", style: TextInputStyle.Paragraph }
            ];

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        if (
            (i.isButton() && i.customId === "open_recruit_modal") ||
            (i.isStringSelectMenu() && i.customId === "recruit_apply_menu" && i.values[0] === "open_recruit_modal")
        ) {
            const modal = new ModalBuilder()
                .setCustomId("apply_modal_recruit")
                .setTitle("Заявка в Recruit");

            const fields = [
                { id: "q1", label: "Ваш ник и статик", placeholder: "Hugo Darkness | 21074", style: TextInputStyle.Short },
                { id: "q2", label: "Имя и возраст (в реале)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "Почему хотите попасть в Recruit?", placeholder: "Хочу помогать семье, набирать новых игроков...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "Есть ли опыт в рекрутинге или схожих ролях?", placeholder: "Да, был рекрутером в семье... / Нет, но готов учиться", style: TextInputStyle.Paragraph }
            ];

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        if (i.isStringSelectMenu() && i.customId === "apply_menu") {
            const type = i.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`apply_modal_${type}`)
                .setTitle(type === "academy" ? "Заявка в Academy" : type === "main" ? "Заявка в Main" : "Заявка в Capture");

            const fields = [
                { id: "q1", label: "ВАШ СТАТИЧЕСКИЙ ID # И ВАШ НИК НЕЙМ", placeholder: "21074 | Hugo Darkness", style: TextInputStyle.Short },
                { id: "q2", label: "ИМЯ И ВОЗРАСТ (В РЕАЛЕ)", placeholder: "Женя | 20", style: TextInputStyle.Short },
                { id: "q3", label: "ЕСТЬ У ВАС ОПЫТ В СЕМЬЯХ? ГДЕ СОСТОЯЛИ?", placeholder: "Да, был в...", style: TextInputStyle.Paragraph },
                { id: "q4", label: "ПОЧЕМУ ВЫБРАЛИ Darkness? КАК УЗНАЛИ О НАС?", placeholder: "Увидел на респе / медиа контент...", style: TextInputStyle.Paragraph }
            ];

            if (type !== "academy") {
                fields.push({ id: "q5", label: "Предоставьте свои откаты", placeholder: "Ссылка на откат с ГГ от 5 минут", style: TextInputStyle.Paragraph });
            }

            modal.addComponents(
                ...fields.map(f => new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setPlaceholder(f.placeholder).setRequired(true).setStyle(f.style)
                ))
            );

            await i.showModal(modal);
            return;
        }

        if (i.isModalSubmit() && i.customId.startsWith("apply_modal_")) {
            if (i.customId === "apply_modal_recruit") {
                // Handled separately below
            } else {
            await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (modalLocks.has(i.user.id)) {
                await i.editReply({ content: "⚠️ Заявка уже обрабатывается. Попробуйте ещё раз через несколько секунд." }).catch(() => null);
                return;
            }
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const type = i.customId.replace("apply_modal_", "");
            const targetCategory = type === "main" ? config.CHANNELS.MAIN_CATEGORY : config.CHANNELS.CATEGORY;
            const expectedChannelName = `${type}-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
            await i.guild.channels.fetch().catch(() => null);

            const existingChannel = i.guild.channels.cache.find(c => 
                c.parentId === targetCategory && 
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.editReply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>` }).catch(() => null);
                return;
            }

            const data = {
                type,
                q1: i.fields.getTextInputValue("q1"),
                q2: type === "main" ? null : i.fields.getTextInputValue("q2"),
                q3: type === "main" ? null : i.fields.getTextInputValue("q3"),
                q4: type === "main" ? null : i.fields.getTextInputValue("q4"),
                q5: type !== "academy" ? i.fields.getTextInputValue("q5") : null,
                userId: i.user.id
            };

            applications.set(i.user.id, data);

            const channel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: targetCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    ...(config.ALLOWED_ROLES ? config.ALLOWED_ROLES.map(role => ({ id: role, allow: ["ViewChannel", "SendMessages"] })) : []),
                    { id: "1468704257606684712", allow: ["ViewChannel", "SendMessages"] } 
                ]
            });

            const buttonsRow = buildAppButtonsRow(i.user.id);
            const container = buildAppContainer({
                type,
                data,
                targetId: i.user.id,
                username: i.user.username,
                statusText: "Ожидает рассмотрения",
                statusKey: "pending",
                buttonsRow
            });

            await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            await i.editReply({ content: `✅ Заявка создана! Канал: <#${channel.id}>` }).catch(() => null);
            await sendApplicationAudit(i.guild, {
                status: "Подана",
                data,
                type,
                targetId: i.user.id,
                username: i.user.username,
                channelId: channel.id
            });

            // Аудит лог — новая заявка (main / capture / academy)
            if (type === "main" && config.CHANNELS.AUDIT_MAIN) {
                const auditCh = await i.guild.channels.fetch(config.CHANNELS.AUDIT_MAIN).catch(() => null);
                if (auditCh) {
                    const auditEmbed = new EmbedBuilder()
                        .setTitle("Заявление — Main состав")
                        .setColor("#1f8b4c")
                        .setDescription(
`**Ваш статик**
${data.q1}

**Предоставьте ваши откаты**
${data.q5}

**Пользователь**
<@${i.user.id}>`)
                        .addFields(
                            { name: "Username", value: i.user.username, inline: true },
                            { name: "ID", value: i.user.id, inline: true },
                            { name: "Тикет", value: `<#${channel.id}>`, inline: true }
                        )
                        .setTimestamp();
                    await auditCh.send({ embeds: [auditEmbed] }).catch(() => null);
                }
            }

            return;
            } // end else (not recruit)
        }

        // =====================================================
        // ОБРАБОТКА ЗАЯВКИ В RECRUIT ОТДЕЛ
        // =====================================================
        if (i.isModalSubmit() && i.customId === "apply_modal_recruit") {
            await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (modalLocks.has(i.user.id)) {
                await i.editReply({ content: "⚠️ Заявка уже обрабатывается. Попробуйте ещё раз через несколько секунд." }).catch(() => null);
                return;
            }
            modalLocks.add(i.user.id);
            setTimeout(() => modalLocks.delete(i.user.id), 5000);

            const recruitCategory = config.CHANNELS.RECRUIT_CATEGORY || config.CHANNELS.CATEGORY;
            const expectedChannelName = `recruit-${i.user.username}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

            await i.guild.channels.fetch().catch(() => null);

            const existingChannel = i.guild.channels.cache.find(c =>
                c.parentId === recruitCategory &&
                c.name === expectedChannelName
            );

            if (existingChannel) {
                await i.editReply({ content: `⚠️ Ваша заявка уже создана: <#${existingChannel.id}>` }).catch(() => null);
                return;
            }

            const recruitData = {
                type: "recruit",
                q1: i.fields.getTextInputValue("q1"),
                q2: i.fields.getTextInputValue("q2"),
                q3: i.fields.getTextInputValue("q3"),
                q4: i.fields.getTextInputValue("q4"),
                userId: i.user.id
            };

            applications.set(i.user.id, recruitData);

            const RECRUIT_ROLE_ID = "1519806507011805215";

            const recruitChannel = await i.guild.channels.create({
                name: expectedChannelName,
                type: ChannelType.GuildText,
                parent: recruitCategory,
                permissionOverwrites: [
                    { id: i.guild.id, deny: ["ViewChannel"] },
                    { id: i.user.id, allow: ["ViewChannel", "SendMessages"] },
                    { id: RECRUIT_ROLE_ID, allow: ["ViewChannel", "SendMessages"] }
                ]
            });

            const recruitButtonsRow = buildAppButtonsRow(i.user.id);
            const recruitContainer = buildAppContainer({
                type: "recruit",
                data: recruitData,
                targetId: i.user.id,
                username: i.user.username,
                statusText: "Ожидает рассмотрения",
                statusKey: "pending",
                buttonsRow: recruitButtonsRow
            });

            await recruitChannel.send({ components: [recruitContainer], flags: MessageFlags.IsComponentsV2 });
            await i.editReply({ content: `✅ Заявка в Recruit создана! Канал: <#${recruitChannel.id}>` }).catch(() => null);
            await sendApplicationAudit(i.guild, {
                status: "Подана",
                data: recruitData,
                type: "recruit",
                targetId: i.user.id,
                username: i.user.username,
                channelId: recruitChannel.id
            });

            // Аудит Recruit — отдельный контейнер в канале AUDIT_RECRUIT.
            await sendDirectApplicationAudit(i.guild, config.CHANNELS.AUDIT_RECRUIT, {
                status: "Подана",
                data: recruitData,
                type: "recruit",
                targetId: i.user.id,
                username: i.user.username,
                channelId: recruitChannel.id
            });

            return;
        }

        if (i.isChannelSelectMenu() && i.customId.startsWith("call_voice_")) {
            const targetId = i.customId.replace("call_voice_", "");
            const voiceChannelId = i.values[0];

            const appData = applications.get(targetId);
            const appType = appData?.type || appTypeFromChannelName(i.channel.name);
            const reviewer = ticketReviewers.get(i.channel.id) || null;

            const messages = await i.channel.messages.fetch({ limit: 20 }).catch(() => null);
            if (messages) {
                const appMessage = messages.find(m => m.author.id === client.user.id && m.flags?.has(MessageFlags.IsComponentsV2));
                if (appMessage) {
                    const targetMemberForName = await i.guild.members.fetch(targetId).catch(() => null);
                    const buttonsRow = buildAppButtonsRow(targetId, {
                        reviewTaken: !!reviewer,
                        reviewerTag: reviewer?.tag || null
                    });
                    const updatedContainer = buildAppContainer({
                        type: appType,
                        data: appData,
                        targetId,
                        username: targetMemberForName?.user?.username || targetId,
                        statusText: "Вызван на обзвон",
                        statusKey: "call",
                        reviewerId: reviewer?.id || null,
                        buttonsRow
                    });
                    await appMessage.edit({ components: [updatedContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
                }
            }

            const voiceUrl = `https://discord.com/channels/${i.guild.id}/${voiceChannelId}`;

            await i.channel.send(`📞 <@${targetId}>, вы вызваны на обзвон администратором <@${i.user.id}>!\nПожалуйста, перейдите в голосовой канал: [Войти в голосовой канал](${voiceUrl}) (<#${voiceChannelId}>).`);

            const targetMember = await i.guild.members.fetch(targetId).catch(() => null);
            if (targetMember) {
                await targetMember.send({
                    content: `🔔 **Привет!** Твоя заявка в семью **Darkness** на сервере **${i.guild.name}** была проверена.\n\nТебя вызвали на обзвон! Пожалуйста, подключись к голосовой канале по прямой ссылке:\n${voiceUrl}`
                }).catch(() => {
                    i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                });
            }

            await i.reply({ content: "✅ Ссылка отправлена кандидату в тикет и в ЛС!", flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.isButton()) {
            const parts = i.customId.split("_");
            const member = await i.guild.members.fetch(i.user.id);

            if (parts[0] === "group" && parts[1] === "start") return;
            if (i.customId === "open_report_modal" || i.customId === "afk_enter" || i.customId === "afk_leave") return;
            if (parts[0] === "report") return;
            if (parts[0] === "p") return;

            if (parts[0] === "audit") {
                const action = parts[1];

                if (action === "verify") {
                    const cId = parts[2];
                    if (!cId || cId === "unknown") {
                        await i.reply({ content: "❌ Не удалось считать корректный Discord ID кандидата.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const isPresent = await i.guild.members.fetch(cId).catch(() => null);
                    if (isPresent) {
                        await i.reply({ content: `🟢 Пользователь <@${cId}> (\`${cId}\`) **находится** на сервере.`, flags: MessageFlags.Ephemeral });
                    } else {
                        await i.reply({ content: `🔴 Пользователь с ID \`${cId}\` **не найден** на сервере (вышел или не заходил).`, flags: MessageFlags.Ephemeral });
                    }
                    return;
                }

                const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
                if (!hasPermission) {
                    await i.reply({ content: "❌ У вас нет прав для управления аудитом.", flags: MessageFlags.Ephemeral });
                    return;
                }

                const recruiterId = parts[2];
                const candidateId = parts[3];

                if (action === "reject") {
                    await i.reply({ content: "❌ Отчёт планшета отклонён. Сообщение удалено.", flags: MessageFlags.Ephemeral });
                    await i.message.delete().catch(() => null);
                    return;
                }

                if (action === "accept") {
                    salary.balances[recruiterId] = (salary.balances[recruiterId] || 0) + 25000;
                    
                    if (candidateId && candidateId !== "unknown") {
                        salary.recruits[candidateId] = recruiterId;
                    }

                    await saveDB(salary);
                    await updateSalaryEmbed(i.guild);

                    await i.reply({ content: "✅ Отчёт успешно подтвержден! Рекрутеру начислено $25,000.", flags: MessageFlags.Ephemeral });
                    await i.message.delete().catch(() => null);
                    return;
                }
            }

            const hasPermission = config.ALLOWED_ROLES && config.ALLOWED_ROLES.some(role => member.roles.cache.has(role));
            if (!hasPermission) {
                await i.reply({ content: "❌ У вас нет прав для нажатия этих кнопок.", flags: MessageFlags.Ephemeral });
                return;
            }

            if (parts[0] === "accept" || parts[0] === "reject") {
                const action = parts[0];
                const targetId = parts[1];
                const embed = EmbedBuilder.from(i.message.embeds[0]);

                if (action === "accept") {
                    salary.balances[targetId] = (salary.balances[targetId] || 0) + 1000;
                    await saveDB(salary);
                    await updateSalaryEmbed(i.guild);
                    embed.setColor("Green").setTitle("📸 Отчёт одобрен");
                    await i.update({ embeds: [embed], components: [] });
                } else {
                    embed.setColor("Red").setTitle("📸 Отчёт отклонён");
                    await i.update({ embeds: [embed], components: [] });
                }
                return;
            }

            if (parts[0] === "app") {
                const action = parts[1];
                const targetId = parts[2];
                const targetMember = await i.guild.members.fetch(targetId).catch(() => null);

                const isAcademy = i.channel.name.startsWith("academy");
                const isMain = i.channel.name.startsWith("main");
                const isRecruit = i.channel.name.startsWith("recruit");
                const appData = applications.get(targetId);
                const appType = appData?.type || appTypeFromChannelName(i.channel.name);
                const appUsername = targetMember?.user?.username || targetId;

                if (action === "accept") {
                    if (!targetMember) {
                        await i.reply({ content: "❌ Пользователь вышел с сервера.", flags: MessageFlags.Ephemeral });
                        return;
                    }

                    let rolesToAdd;
                    if (isAcademy) rolesToAdd = config.ACADEMY_ROLES;
                    else if (isMain) rolesToAdd = config.MAIN_ROLES;
                    else if (isRecruit) rolesToAdd = ["1468704257606684712"];
                    else rolesToAdd = [...new Set([...(config.CAPTURE_ROLES || []), PORTFOLIO_TIER_C_ROLE_ID])];
                    await targetMember.roles.add(rolesToAdd).catch(() => null);
                    if (isAcademy) await targetMember.roles.remove("1458410670071615580").catch(() => null);

                    const liveData = applications.get(targetId);
                    salary.archive[targetId] = {
                        acceptedBy: i.user.id,
                        timestamp: new Date().toISOString(),
                        fields: liveData || { q1: "Не сохр.", q2: "Не сохр.", q3: "Не сохр.", q4: "Не сохр." }
                    };
                    await saveDB(salary);

                    const closedContainer = buildAppContainer({
                        type: appType,
                        data: appData,
                        targetId,
                        username: appUsername,
                        statusText: (isMain || isRecruit) ? "Принято" : "Принято и закрыто",
                        statusKey: "accepted"
                    });

                    if (isMain || isRecruit) {
                        await i.update({ components: [closedContainer], flags: MessageFlags.IsComponentsV2 });
                    } else {
                        await i.channel.permissionOverwrites.edit(targetId, {
                            ViewChannel: false,
                            SendMessages: false
                        }).catch(() => null);

                        const cleanName = i.channel.name.replace("academy-", "").replace("capture-", "").replace("main-", "").replace("recruit-", "");
                        await i.channel.setName(`closed-${cleanName}`).catch(() => null);

                        await i.update({ components: [closedContainer], flags: MessageFlags.IsComponentsV2 });
                    }

                    ticketReviewers.delete(i.channel.id);
                    await sendApplicationAudit(i.guild, {
                        status: "Принята",
                        data: appData,
                        type: appType,
                        targetId,
                        username: appUsername,
                        channelId: i.channel.id,
                        actorId: i.user.id
                    });

                    const auditChannelId = isMain
                        ? config.CHANNELS.AUDIT_MAIN
                        : isRecruit
                            ? config.CHANNELS.AUDIT_RECRUIT
                            : config.CHANNELS.AUDIT_APP;
                    if (auditChannelId) {
                        const auditChannel = await i.guild.channels.fetch(auditChannelId).catch(() => null);
                        if (auditChannel) {
                            const auditLabel = isMain ? "Main состав" : isRecruit ? "Recruit" : "Семья";
                            if (isRecruit) {
                                await auditChannel.send({
                                    components: [buildDirectApplicationAuditContainer({
                                        status: "Принята",
                                        data: appData,
                                        type: appType,
                                        targetId,
                                        username: appUsername,
                                        channelId: i.channel.id,
                                        actorId: i.user.id
                                    })],
                                    flags: MessageFlags.IsComponentsV2,
                                    allowedMentions: { parse: [] }
                                }).catch(() => null);
                            } else {
                                const auditEmbed = new EmbedBuilder()
                                    .setColor("Green")
                                    .setTitle(`✅ Заявка принята | ${auditLabel}`)
                                    .setDescription(buildAppBodyText(appType, appData))
                                    .addFields(
                                        { name: "Кого", value: `<@${targetId}>`, inline: true },
                                        { name: "Принял", value: `<@${i.user.id}>`, inline: true }
                                    )
                                    .setTimestamp();
                                await auditChannel.send({ embeds: [auditEmbed] }).catch(() => null);
                            }
                        }
                    }

                    if (isMain || isRecruit) {
                        const dmText = isRecruit
                            ? `👋 **Привет!** Твоя заявка в **отдел Recruit** Darkness на сервере **${i.guild.name}** была проверена.\n\n🎉 Поздравляем, ты успешно принят в Recruit!`
                            : `👋 **Привет!** Твоя заявка в **Main состав** Darkness на сервере **${i.guild.name}** была проверена.\n\n🎉 Поздравляем, кандидат успешно принят в Main состав!`;
                        await targetMember.send({ content: dmText }).catch(() => {
                            i.channel.send(`⚠️ <@${targetId}>, бот не смог написать вам в ЛС, так как у вас закрыты личные сообщения!`).catch(() => null);
                        });

                        await i.channel.send({ content: `🎉 Кандидат <@${targetId}> успешно принят! Тикет будет удалён через несколько секунд.` }).catch(() => null);

                        setTimeout(() => {
                            i.channel.delete().catch(() => null);
                        }, 5000);
                    } else {
                        await i.channel.send({
                            content: `🎉 <@${targetId}> успешно принят!\n\n💼 <@${i.user.id}>, кандидат убран из тикета. Пожалуйста, **отправьте сюда скриншот с планшета**, чтобы зафиксировать отчет в аудите.`
                        });
                    }
                    return;
                }

                if (action === "review") {
                    // Если заявку уже кто-то рассматривает — другой рекрут забрать её не может
                    const currentReviewer = ticketReviewers.get(i.channel.id);
                    if (currentReviewer && currentReviewer.id !== i.user.id) {
                        await i.reply({
                            content: `❌ Эту заявку уже рассматривает <@${currentReviewer.id}>. Дождитесь, пока она освободится.`,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    ticketReviewers.set(i.channel.id, { id: i.user.id, tag: i.user.username });

                    const reviewButtonsRow = buildAppButtonsRow(targetId, {
                        reviewTaken: true,
                        reviewerTag: i.user.username
                    });
                    const reviewContainer = buildAppContainer({
                        type: appType,
                        data: appData,
                        targetId,
                        username: appUsername,
                        statusText: "На рассмотрении",
                        statusKey: "review",
                        reviewerId: i.user.id,
                        buttonsRow: reviewButtonsRow
                    });
                    await i.update({ components: [reviewContainer], flags: MessageFlags.IsComponentsV2 });
                    await sendApplicationAudit(i.guild, {
                        status: "Рассмотрена",
                        data: appData,
                        type: appType,
                        targetId,
                        username: appUsername,
                        channelId: i.channel.id,
                        actorId: i.user.id
                    });

                    const reviewAuditId = isMain
                        ? config.CHANNELS.AUDIT_MAIN
                        : isRecruit
                            ? config.CHANNELS.AUDIT_RECRUIT
                            : config.CHANNELS.AUDIT_APP;
                    if (reviewAuditId) {
                        const auditChannel = await i.guild.channels.fetch(reviewAuditId).catch(() => null);
                        if (auditChannel) {
                            if (isRecruit) {
                                await auditChannel.send({
                                    components: [buildDirectApplicationAuditContainer({
                                        status: "Рассмотрена",
                                        data: appData,
                                        type: appType,
                                        targetId,
                                        username: appUsername,
                                        channelId: i.channel.id,
                                        actorId: i.user.id
                                    })],
                                    flags: MessageFlags.IsComponentsV2,
                                    allowedMentions: { parse: [] }
                                }).catch(() => null);
                            } else {
                                const auditEmbed = new EmbedBuilder()
                                    .setColor("Yellow")
                                    .setTitle("⏳ Заявка на рассмотрении")
                                    .setDescription(buildAppBodyText(appType, appData))
                                    .addFields(
                                        { name: "Кого", value: `<@${targetId}>`, inline: true },
                                        { name: "Взял на рассмотрение", value: `<@${i.user.id}>`, inline: true }
                                    )
                                    .setTimestamp();
                                await auditChannel.send({ embeds: [auditEmbed] }).catch(() => null);
                            }
                        }
                    }

                    await i.channel.send(`⏳ Администратор <@${i.user.id}> взял заявку на рассмотрение.`);
                    return;
                }

                if (action === "call") {
                    const voiceMenu = new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId(`call_voice_${targetId}`)
                            .setPlaceholder("Выберите голосовой канал для кандидата")
                            .addChannelTypes(ChannelType.GuildVoice)
                    );

                    await i.reply({
                        content: "⬇️ Выберите из выпадающего списка ниже войс-канал, в который отправить кандидата:",
                        components: [voiceMenu],
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (action === "reject") {
                    const modal = new ModalBuilder()
                        .setCustomId(`app_reject_modal_${targetId}`)
                        .setTitle("Причина отказа по заявке");

                    const reasonInput = new TextInputBuilder()
                        .setCustomId("reject_reason_input")
                        .setLabel("Укажите причину отказа:")
                        .setPlaceholder("Неподходящие откаты / Неадекватное поведение в анкете")
                        .setRequired(true)
                        .setStyle(TextInputStyle.Paragraph);

                    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                    await i.showModal(modal);
                    return;
                }
            }
        }

    } catch (e) {
        console.log(`[INTERACTION ERROR HANDLED] [${INSTANCE_ID}]`, e);
    }
});


// =====================================================
// GUILD MEMBER UPDATE — вычет когда осталась только 1 роль
// =====================================================
const DEDUCT_ROLE_ID = "1458410670071615580";
const PERSONAL_REPORT_ROLE_ID = "1458410756453306490";
const PERSONAL_REPORT_CATEGORY_ID = "1540292539943485450";
const PERSONAL_REPORT_ARCHIVE_CATEGORY_ID = "1541144152689999932";
const PERSONAL_REPORT_VIEW_ROLE_ID = "1541082447293452450";
const PERSONAL_REPORT_HIGH_RANK_ROLE_ID = "1458484199735689299";
const PERSONAL_REPORT_TOPIC_PREFIX = "darkness-personal-report:";
const PORTFOLIO_TOPIC_PREFIX = "portfolio_";
const PERSONAL_REPORT_FORUM_ID = "1543149973044990062"; // legacy forum, migration source only
const PORTFOLIO_ADMIN_TOPIC_PREFIX = "darkness-portfolio-admin:";
const PORTFOLIO_CATEGORY_NAME = "Портфели";
const PORTFOLIO_ARCHIVE_CATEGORY_NAME = "Архив портфелей";
const DISCORD_CATEGORY_CHANNEL_LIMIT = 50;
const PORTFOLIO_REWARD_RP_POINTS = 10;
const PORTFOLIO_REWARD_CAPT_POINTS = 15;
const PORTFOLIO_TIER_A_ROLE_ID = "1541151892309278811";
const PORTFOLIO_TIER_B_ROLE_ID = "1541151934944125019";
const PORTFOLIO_TIER_C_ROLE_ID = "1541151978631995453";
const PORTFOLIO_TIER_ROLE_IDS = [PORTFOLIO_TIER_A_ROLE_ID, PORTFOLIO_TIER_B_ROLE_ID, PORTFOLIO_TIER_C_ROLE_ID];

function personalReportNoticePayload({ userId, title, message, color = 0xE74C3C, mentionHighRank = true }) {
    const container = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(message));

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: mentionHighRank
            ? { roles: [PERSONAL_REPORT_HIGH_RANK_ROLE_ID] }
            : { parse: [] }
    };
}

function portfolioBaseChannelName(member) {
    const rawName = String(member?.user?.username || member?.displayName || "user")
        .toLowerCase()
        .replace(/[^a-z0-9а-яё_-]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 70) || "user";
    return rawName;
}

function personalReportChannelName(member) {
    return portfolioBaseChannelName(member).slice(0, 100);
}

function extractPortfolioUserId(topic) {
    const value = String(topic || "");
    if (value.startsWith(PERSONAL_REPORT_TOPIC_PREFIX)) return value.replace(PERSONAL_REPORT_TOPIC_PREFIX, "");
    if (value.startsWith(PORTFOLIO_TOPIC_PREFIX)) return value.replace(PORTFOLIO_TOPIC_PREFIX, "");
    return null;
}

function portfolioCategoryIds(guild) {
    return guild?.channels?.cache
        ? [...guild.channels.cache.values()]
            .filter(channel => channel.type === ChannelType.GuildCategory)
            .filter(channel => {
                const name = String(channel.name || "");
                return [
                    PERSONAL_REPORT_CATEGORY_ID,
                    PERSONAL_REPORT_ARCHIVE_CATEGORY_ID,
                    SERVERS[guild.id]?.CHANNELS?.PORTFOLIO_CATEGORY
                ].includes(channel.id) ||
                    name === PORTFOLIO_CATEGORY_NAME || name.startsWith(`${PORTFOLIO_CATEGORY_NAME} `) ||
                    name === PORTFOLIO_ARCHIVE_CATEGORY_NAME || name.startsWith(`${PORTFOLIO_ARCHIVE_CATEGORY_NAME} `);
            })
            .map(channel => channel.id)
        : [];
}

function categoryNameForPortfolioType(type) {
    return {
        active: PORTFOLIO_CATEGORY_NAME,
        archive: PORTFOLIO_ARCHIVE_CATEGORY_NAME
    }[type];
}

async function configurePortfolioCategory(category, type) {
    if (!category?.permissionOverwrites) return;
    await category.permissionOverwrites.edit(category.guild.id, { ViewChannel: false }).catch(() => null);
    await category.permissionOverwrites.edit(PERSONAL_REPORT_VIEW_ROLE_ID, {
        ViewChannel: true,
        ReadMessageHistory: true
    }).catch(() => null);
    await category.permissionOverwrites.edit(PERSONAL_REPORT_HIGH_RANK_ROLE_ID, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
    }).catch(() => null);
    await category.permissionOverwrites.edit(client.user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        ManageChannels: true,
        ManageMessages: true
    }).catch(() => null);
}

async function getAvailablePortfolioCategory(guild, type, requiredSlots = 1) {
    await guild.channels.fetch().catch(() => null);
    const baseId = type === "active"
        ? PERSONAL_REPORT_CATEGORY_ID
        : type === "archive"
            ? PERSONAL_REPORT_ARCHIVE_CATEGORY_ID
            : null;
    const baseName = categoryNameForPortfolioType(type);
    const categories = guild.channels.cache.filter(channel => {
        if (channel.type !== ChannelType.GuildCategory) return false;
        if (channel.id === baseId) return true;
        const name = String(channel.name || "");
        return name === baseName || name.startsWith(`${baseName} `);
    });

    const ordered = [...categories.values()].sort((a, b) => a.position - b.position);
    for (const category of ordered) {
        if ((category.children?.cache?.size || 0) + requiredSlots <= DISCORD_CATEGORY_CHANNEL_LIMIT) {
            await configurePortfolioCategory(category, type);
            return category;
        }
    }

    let nextNumber = 1;
    const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`, "i");
    for (const category of ordered) {
        const match = String(category.name || "").match(pattern);
        if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
    }
    if (baseId && ordered.some(category => category.id === baseId)) nextNumber = Math.max(nextNumber, 2);

    const category = await guild.channels.create({
        name: `${baseName} ${nextNumber}`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
            { id: guild.id, deny: ["ViewChannel"] },
            { id: PERSONAL_REPORT_VIEW_ROLE_ID, allow: ["ViewChannel", "ReadMessageHistory"] },
            { id: PERSONAL_REPORT_HIGH_RANK_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
            { id: client.user.id, allow: ["ViewChannel", "SendMessages", "SendMessagesInThreads", "ReadMessageHistory", "CreatePrivateThreads", "ManageThreads", "ManageChannels", "ManageMessages"] }
        ]
    }).catch(error => {
        console.error(`[PORTFOLIO CATEGORY CREATE ERROR] ${type}`, error);
        return null;
    });
    return category;
}

function isArchivePortfolioCategory(guild, categoryId) {
    const category = guild.channels.cache.get(categoryId);
    if (!category) return categoryId === PERSONAL_REPORT_ARCHIVE_CATEGORY_ID;
    const name = String(category.name || "");
    return category.id === PERSONAL_REPORT_ARCHIVE_CATEGORY_ID || name === PORTFOLIO_ARCHIVE_CATEGORY_NAME || name.startsWith(`${PORTFOLIO_ARCHIVE_CATEGORY_NAME} `);
}

function isActivePortfolioCategory(guild, categoryId) {
    const category = guild.channels.cache.get(categoryId);
    if (!category) return categoryId === PERSONAL_REPORT_CATEGORY_ID;
    const name = String(category.name || "");
    return category.id === PERSONAL_REPORT_CATEGORY_ID || name === PORTFOLIO_CATEGORY_NAME || name.startsWith(`${PORTFOLIO_CATEGORY_NAME} `);
}

async function findPersonalReportChannel(guild, userId, refresh = false) {
    if (!guild || guild.id !== "1458190222042075251") return null;
    if (refresh) await guild.channels.fetch().catch(() => null);

    return guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText &&
        extractPortfolioUserId(channel.topic) === String(userId)
    ) || null;
}

async function createPrivatePortfolioChannel(member, topicPrefix = PORTFOLIO_TOPIC_PREFIX) {
    const guild = member?.guild;
    if (!guild || guild.id !== "1458190222042075251") return null;

    const category = await getAvailablePortfolioCategory(guild, "active", 1);
    if (!category) return null;

    const permissionOverwrites = [
        { id: guild.id, deny: ["ViewChannel"] },
        { id: member.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"] },
        { id: PERSONAL_REPORT_VIEW_ROLE_ID, allow: ["ViewChannel", "ReadMessageHistory"] },
        { id: PERSONAL_REPORT_HIGH_RANK_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: client.user.id, allow: ["ViewChannel", "SendMessages", "SendMessagesInThreads", "ReadMessageHistory", "CreatePrivateThreads", "ManageThreads", "ManageChannels", "ManageMessages"] }
    ];

    const channel = await guild.channels.create({
        name: personalReportChannelName(member),
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `${topicPrefix}${member.id}`,
        permissionOverwrites
    }).catch(error => {
        console.error("[PORTFOLIO CREATE ERROR]", error);
        return null;
    });

    if (channel) {
        await ensurePortfolioInfoPanel(member, channel);
    }

    return channel;
}

async function ensurePrivatePortfolioChannel(member) {
    const guild = member?.guild;
    if (!guild || guild.id !== "1458190222042075251") return { channel: null, created: false };

    let channel = await findPersonalReportChannel(guild, member.id, true);
    let created = false;
    if (!channel) {
        channel = await createPrivatePortfolioChannel(member);
        created = Boolean(channel);
    }
    if (!channel) return { channel: null, created: false };

    if (isArchivePortfolioCategory(guild, channel.parentId)) {
        const activeCategory = await getAvailablePortfolioCategory(guild, "active", 1);
        if (activeCategory && channel.parentId !== activeCategory.id) {
            await channel.setParent(activeCategory.id, { lockPermissions: false }).catch(() => null);
        }
    }

    if (channel.name !== personalReportChannelName(member)) {
        await channel.setName(personalReportChannelName(member)).catch(() => null);
    }
    await channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
    }).catch(() => null);
    await channel.permissionOverwrites.edit(PERSONAL_REPORT_VIEW_ROLE_ID, {
        ViewChannel: true,
        ReadMessageHistory: true
    }).catch(() => null);
    await channel.permissionOverwrites.edit(PERSONAL_REPORT_HIGH_RANK_ROLE_ID, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
    }).catch(() => null);

    await ensurePortfolioInfoPanel(member, channel);
    await ensurePortfolioAdminThread(member, channel);
    return { channel, created };
}

async function ensurePersonalReportChannel(member) {
    const result = await ensurePrivatePortfolioChannel(member);
    return result.channel;
}

function buildPortfolioInfoPayload(member) {
    const container = new ContainerBuilder()
        .setAccentColor(0x2B2D31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 📁 Личный канал отчётов"))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Участник:** <@${member.id}>\n\n` +
            `Сюда ты должен кидать скрины, откаты с каптов, РП-шек, арены и проявлять актив.`
        ));

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
}

async function ensurePortfolioInfoPanel(member, channel) {
    if (!member || !channel?.messages) return;
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return;

    const infoMessages = messages.filter(message =>
        message.author?.id === client.user.id && (
            componentsContainText(message.components, "Сюда ты должен кидать") ||
            componentsContainText(message.components, "Сюда необходимо отправлять") ||
            message.embeds?.some(embed => String(embed.title || "").includes("Личный канал отчётов"))
        )
    );
    const currentMessage = infoMessages.find(message =>
        componentsContainText(message.components, "Сюда ты должен кидать") ||
        componentsContainText(message.components, "Сюда необходимо отправлять")
    );

    if (currentMessage) {
        await currentMessage.edit(buildPortfolioInfoPayload(member)).catch(() => null);
    }
    for (const message of infoMessages.values()) {
        if (message.id !== currentMessage?.id) await message.delete().catch(() => null);
    }
    if (!currentMessage) {
        await channel.send(buildPortfolioInfoPayload(member)).catch(() => null);
    }
}

function componentsContainText(components, text) {
    if (!components) return false;
    for (const component of components) {
        if (typeof component.content === "string" && component.content.includes(text)) return true;
        if (component.components && componentsContainText(component.components, text)) return true;
    }
    return false;
}

async function deletePersonalReportRoleLostNotice(guild, userId) {
    const channel = await findPersonalReportChannel(guild, userId, true);
    if (!channel) return;

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;

    const notices = messages.filter(message =>
        message.author?.id === client.user.id &&
        componentsContainText(message.components, "Роль участника снята")
    );
    for (const notice of notices.values()) {
        await notice.delete().catch(() => null);
    }
}

async function notifyPersonalReportRoleLost(guild, userId, reason) {
    const channel = await findPersonalReportChannel(guild, userId, true);
    if (!channel) return;

    await channel.send(personalReportNoticePayload({
        userId,
        title: reason === "leave" ? "📤 Участник вышел с сервера" : "⚠️ Роль участника снята",
        message: reason === "leave"
            ? `<@${userId}> вышел с сервера. Портфель перенесён в архив.\n\n<@&${PERSONAL_REPORT_HIGH_RANK_ROLE_ID}> требуется учесть это в кадровом составе.`
            : `<@${userId}> потерял роль <@&${PERSONAL_REPORT_ROLE_ID}>. Портфель перенесён в архив.\n\n<@&${PERSONAL_REPORT_HIGH_RANK_ROLE_ID}> требуется проверить участника.`,
        color: 0xE74C3C,
        mentionHighRank: true
    })).catch(() => null);

    const archiveCategory = await getAvailablePortfolioCategory(guild, "archive", 1);
    if (archiveCategory && channel.parentId !== archiveCategory.id) {
        await channel.setParent(archiveCategory.id, { lockPermissions: false }).catch(() => null);
    }
    await channel.permissionOverwrites.delete(userId).catch(() => null);
}

async function migrateForumPortfoliosToChannels(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;
    const forum = await guild.channels.fetch(PERSONAL_REPORT_FORUM_ID).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) return;

    const active = await forum.threads.fetchActive().catch(() => null);
    const archived = await forum.threads.fetchArchived({ type: "public", limit: 100 }).catch(() => null);
    const threads = [
        ...Array.from(active?.threads?.values?.() || []),
        ...Array.from(archived?.threads?.values?.() || [])
    ];

    for (const thread of [...new Map(threads.map(item => [item.id, item])).values()]) {
        const match = String(thread.name || "").match(/^portfolio-(\d{15,25})$/);
        if (!match) continue;
        const userId = match[1];

        let channel = await findPersonalReportChannel(guild, userId, true);
        if (!channel) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) continue;
            channel = await createPrivatePortfolioChannel(member);
            if (!channel) continue;
            await ensurePortfolioAdminThread(member, channel);

            if (thread.archived) {
                const archiveCategory = await getAvailablePortfolioCategory(guild, "archive", 1);
                if (archiveCategory) {
                    await channel.setParent(archiveCategory.id, { lockPermissions: false }).catch(() => null);
                }
                await channel.permissionOverwrites.delete(userId).catch(() => null);
            }

            const messages = await thread.messages.fetch({ limit: 100 }).catch(() => null);
            if (messages) {
                const orderedMessages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                for (const message of orderedMessages) {
                    try {
                        if (message.components?.length && message.flags?.has(MessageFlags.IsComponentsV2)) {
                            const components = message.components.map(component =>
                                typeof component.toJSON === "function" ? component.toJSON() : component
                            );
                            await channel.send({
                                components,
                                flags: MessageFlags.IsComponentsV2,
                                allowedMentions: { parse: [] }
                            });
                        } else {
                            const attachmentLinks = [...message.attachments.values()].map(attachment => attachment.url);
                            const content = [message.content, ...attachmentLinks].filter(Boolean).join("\n");
                            if (content) await channel.send({ content, allowedMentions: { parse: [] } });
                        }
                    } catch (error) {
                        console.error(`[PORTFOLIO MIGRATION MESSAGE ERROR] ${thread.id}`, error);
                    }
                }
            }
        }

        await thread.setArchived(true).catch(() => null);
    }
}

async function normalizePortfolioChannelNames(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;
    await guild.channels.fetch().catch(() => null);

    const portfolioChannels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText && extractPortfolioUserId(channel.topic)
    );

    for (const channel of portfolioChannels.values()) {
        const userId = extractPortfolioUserId(channel.topic);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        const expectedName = personalReportChannelName(member);
        if (channel.name !== expectedName) {
            await channel.setName(expectedName).catch(() => null);
        }
    }
}

async function removeLegacyPortfolioAdminChannels(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;
    await guild.channels.fetch().catch(() => null);

    const legacyAdminChannels = guild.channels.cache.filter(channel => {
        if (channel.type !== ChannelType.GuildText) return false;
        const topic = String(channel.topic || "").toLowerCase();
        const name = String(channel.name || "").toLowerCase().replace(/\s+/g, " ").trim();
        return topic.startsWith(PORTFOLIO_ADMIN_TOPIC_PREFIX.toLowerCase()) ||
            name.startsWith("┌ админ ") ||
            name.startsWith("admin-") ||
            name.startsWith("admin-└ ");
    });

    for (const channel of legacyAdminChannels.values()) {
        try {
            await channel.delete("Удаление старого отдельного админ-канала портфеля");
            console.log(`[PORTFOLIO] Удалён старый админ-канал: ${channel.name} (${channel.id})`);
        } catch (error) {
            console.error(`[PORTFOLIO ADMIN DELETE ERROR] ${channel.name} (${channel.id})`, error);
        }
    }
}

async function restoreLegacyPortfolioChannels(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;
    await guild.channels.fetch().catch(() => null);

    const legacyCategoryId = SERVERS[guild.id]?.CHANNELS?.PORTFOLIO_CATEGORY;
    if (!legacyCategoryId) return;

    const legacyChannels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === legacyCategoryId &&
        extractPortfolioUserId(channel.topic)
    );

    for (const channel of legacyChannels.values()) {
        const userId = extractPortfolioUserId(channel.topic);
        const member = await guild.members.fetch(userId).catch(() => null);
        const hasPortfolioRole = Boolean(member?.roles.cache.has(PERSONAL_REPORT_ROLE_ID));
        const targetCategory = await getAvailablePortfolioCategory(guild, hasPortfolioRole ? "active" : "archive", 1);

        if (targetCategory && channel.parentId !== targetCategory.id) {
            await channel.setParent(targetCategory.id, { lockPermissions: false }).catch(() => null);
        }

        await channel.permissionOverwrites.edit(PERSONAL_REPORT_VIEW_ROLE_ID, {
            ViewChannel: true,
            ReadMessageHistory: true
        }).catch(() => null);
        await channel.permissionOverwrites.edit(PERSONAL_REPORT_HIGH_RANK_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        }).catch(() => null);

        if (hasPortfolioRole && member) {
            await channel.permissionOverwrites.edit(member.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true
            }).catch(() => null);
        } else {
            await channel.permissionOverwrites.delete(userId).catch(() => null);
        }

    }
}

async function ensurePersonalReportCategoryAccess(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;
    await guild.channels.fetch().catch(() => null);

    const categoryIds = portfolioCategoryIds(guild);

    for (const categoryId of [...new Set(categoryIds)]) {
        const category = await guild.channels.fetch(categoryId).catch(() => null);
        if (!category || category.type !== ChannelType.GuildCategory) {
            console.error(`[PERSONAL REPORT] Категория ${categoryId} не найдена.`);
            continue;
        }

        await category.permissionOverwrites.edit(PERSONAL_REPORT_VIEW_ROLE_ID, {
            ViewChannel: true,
            ReadMessageHistory: true
        }).catch(() => null);
        await category.permissionOverwrites.edit(PERSONAL_REPORT_HIGH_RANK_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        }).catch(() => null);

        const channels = guild.channels.cache.filter(channel =>
            channel.type === ChannelType.GuildText && channel.parentId === category.id
        );
        for (const channel of channels.values()) {
            await channel.permissionOverwrites.edit(PERSONAL_REPORT_VIEW_ROLE_ID, {
                ViewChannel: true,
                ReadMessageHistory: true
            }).catch(() => null);
            await channel.permissionOverwrites.edit(PERSONAL_REPORT_HIGH_RANK_ROLE_ID, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            }).catch(() => null);
        }
    }
}

async function initPersonalReportChannels(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;
    await guild.members.fetch().catch(() => null);
    for (const member of guild.members.cache.values()) {
        if (member.roles.cache.has(PERSONAL_REPORT_ROLE_ID)) {
            await ensurePersonalReportChannel(member);
        }
    }
}

function hasPortfolioAdminAccess(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.roles?.cache?.has(PERSONAL_REPORT_VIEW_ROLE_ID) ||
        interaction.member?.roles?.cache?.has(PERSONAL_REPORT_HIGH_RANK_ROLE_ID)
    );
}

function buildPortfolioAdminThreadContainer(userId, displayName) {
    const rewardRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`portfolio_thread_reward_rp_${userId}`)
            .setLabel(`Выдать +${PORTFOLIO_REWARD_RP_POINTS} за РП отчёт`)
            .setEmoji("📋")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`portfolio_thread_reward_capt_${userId}`)
            .setLabel(`Выдать +${PORTFOLIO_REWARD_CAPT_POINTS} за капт`)
            .setEmoji("⚔️")
            .setStyle(ButtonStyle.Secondary)
    );
    const tierRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`portfolio_thread_tier_up_${userId}`)
            .setLabel("Повысить тир")
            .setEmoji("⬆️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`portfolio_thread_tier_down_${userId}`)
            .setLabel("Понизить тир")
            .setEmoji("⬇️")
            .setStyle(ButtonStyle.Secondary)
    );

    return new ContainerBuilder()
        .setAccentColor(0x2B2D31)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Админ-панель\n-# Портфель: ${displayName}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `📋 РП отчёт — **+${PORTFOLIO_REWARD_RP_POINTS} балла**\n` +
            `⚔️ Капт — **+${PORTFOLIO_REWARD_CAPT_POINTS} баллов**\n` +
            `⬆️ / ⬇️ — изменить тир участника`
        ))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(rewardRow)
        .addActionRowComponents(tierRow);
}

async function findPortfolioAdminThread(portfolioChannel) {
    if (!portfolioChannel?.threads) return null;
    const active = await portfolioChannel.threads.fetchActive().catch(() => null);
    const archived = await portfolioChannel.threads.fetchArchived({ type: "private", limit: 100 }).catch(() => null);
    const threads = [
        ...Array.from(active?.threads?.values?.() || []),
        ...Array.from(archived?.threads?.values?.() || [])
    ];
    return [...new Map(threads.map(thread => [thread.id, thread])).values()]
        .find(thread => thread.name === "Админ-панель") || null;
}

// Участники админ-веток портфелей: хайки и чекеры.
// Администраторов сохраняем в ветках независимо от этих ролей, чтобы не лишать их доступа.
function shouldBePortfolioAdminThreadMember(member) {
    return Boolean(
        member &&
        !member.user?.bot &&
        (
            member.permissions?.has(PermissionFlagsBits.Administrator) ||
            member.roles?.cache?.has(PERSONAL_REPORT_VIEW_ROLE_ID) ||
            member.roles?.cache?.has(PERSONAL_REPORT_HIGH_RANK_ROLE_ID)
        )
    );
}

async function syncPortfolioAdminThreadMember(thread, member) {
    if (!thread || !member || member.user?.bot) return;

    if (shouldBePortfolioAdminThreadMember(member)) {
        if (thread.archived) await thread.setArchived(false).catch(() => null);
        await thread.members.add(member.id).catch(() => null);
    } else {
        await thread.members.remove(member.id).catch(() => null);
    }
}

async function syncPortfolioAdminMemberInAllThreads(member) {
    const guild = member?.guild;
    if (!guild || guild.id !== "1458190222042075251") return;

    await guild.channels.fetch().catch(() => null);
    const portfolioChannels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText && extractPortfolioUserId(channel.topic)
    );

    for (const portfolioChannel of portfolioChannels.values()) {
        let thread = await findPortfolioAdminThread(portfolioChannel);

        // Если ветка была удалена/ещё не создалась — восстанавливаем её вместе с панелью.
        if (!thread) {
            const ownerId = extractPortfolioUserId(portfolioChannel.topic);
            const owner = ownerId ? await guild.members.fetch(ownerId).catch(() => null) : null;
            if (owner) thread = await ensurePortfolioAdminThread(owner, portfolioChannel);
        }

        if (thread) await syncPortfolioAdminThreadMember(thread, member);
    }
}

async function syncAllPortfolioAdminThreads(guild) {
    if (!guild || guild.id !== "1458190222042075251") return;

    await guild.members.fetch().catch(() => null);
    await guild.channels.fetch().catch(() => null);

    const portfolioChannels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildText && extractPortfolioUserId(channel.topic)
    );

    for (const portfolioChannel of portfolioChannels.values()) {
        const ownerId = extractPortfolioUserId(portfolioChannel.topic);
        const owner = ownerId ? await guild.members.fetch(ownerId).catch(() => null) : null;
        if (!owner) continue;

        const thread = await ensurePortfolioAdminThread(owner, portfolioChannel);
        if (!thread) continue;

        const threadMembers = await thread.members.fetch().catch(() => null);
        if (!threadMembers) continue;

        for (const threadMember of threadMembers.values()) {
            const guildMember = guild.members.cache.get(threadMember.id) ||
                await guild.members.fetch(threadMember.id).catch(() => null);
            await syncPortfolioAdminThreadMember(thread, guildMember);
        }
    }
}

async function ensurePortfolioAdminThread(member, portfolioChannel) {
    if (!member?.guild || !portfolioChannel) return null;
    const guild = member.guild;
    let thread = await findPortfolioAdminThread(portfolioChannel);

    if (!thread) {
        thread = await portfolioChannel.threads.create({
            name: "Админ-панель",
            type: ChannelType.PrivateThread,
            autoArchiveDuration: 10080,
            reason: `Админ-панель портфеля ${member.user.username}`
        }).catch(error => {
            console.error("[PORTFOLIO ADMIN THREAD CREATE ERROR]", error);
            return null;
        });
    }
    if (!thread) return null;
    if (thread.archived) await thread.setArchived(false).catch(() => null);

    const admins = guild.members.cache.filter(currentMember =>
        shouldBePortfolioAdminThreadMember(currentMember)
    );
    for (const admin of admins.values()) {
        await syncPortfolioAdminThreadMember(thread, admin);
    }

    // Чистим старых участников: если хайка/чекера больше нет, доступ к ветке убирается.
    const threadMembers = await thread.members.fetch().catch(() => null);
    if (threadMembers) {
        for (const threadMember of threadMembers.values()) {
            const guildMember = guild.members.cache.get(threadMember.id) ||
                await guild.members.fetch(threadMember.id).catch(() => null);
            await syncPortfolioAdminThreadMember(thread, guildMember);
        }
    }

    const messages = await thread.messages.fetch({ limit: 50 }).catch(() => null);
    const panelMessage = messages?.find(message =>
        message.author?.id === client.user.id &&
        componentsContainText(message.components, "Админ-панель")
    );
    const panelPayload = {
        components: [buildPortfolioAdminThreadContainer(member.id, portfolioBaseChannelName(member))],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    };
    if (panelMessage) {
        await panelMessage.edit(panelPayload).catch(() => null);
    } else {
        await thread.send(panelPayload).catch(() => null);
    }
    return thread;
}

async function sendRpReportToPersonalChannel(guild, userId, rpData, evidenceUrl) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.roles.cache.has(PERSONAL_REPORT_ROLE_ID)) return;

    const channel = await ensurePersonalReportChannel(member);
    if (!channel) return;

    const container = new ContainerBuilder()
        .setAccentColor(0x3498DB)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 📋 Новый РП отчёт"))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Участник:** <@${userId}>\n` +
            `**На что подал:** ${clipLogText(rpData.label || "РП отчёт")}\n` +
            `**Название:** ${clipLogText(rpData.rpName || rpData.label || "—")}\n` +
            `**Баллов при одобрении:** +${rpData.points ?? 0}\n` +
            `**Доказательство:** ${evidenceUrl}`
        ));

    const evidenceIsImage = evidenceUrl && (
        /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(evidenceUrl) ||
        evidenceUrl.includes("cdn.discordapp.com/attachments/")
    );
    if (evidenceIsImage) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(evidenceUrl)
            )
        );
    }

    await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
    }).catch(error => console.error("[PERSONAL REPORT SEND ERROR]", error));
}

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        // Роли без @everyone до и после изменения
        const oldRoles = oldMember.roles.cache.filter(r => r.id !== newMember.guild.id);
        const newRoles = newMember.roles.cache.filter(r => r.id !== newMember.guild.id);

        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

        if (addedRoles.has(PERSONAL_REPORT_ROLE_ID)) {
            await ensurePersonalReportChannel(newMember);
            await deletePersonalReportRoleLostNotice(newMember.guild, newMember.id);
        }
        if (removedRoles.has(PERSONAL_REPORT_ROLE_ID)) {
            await notifyPersonalReportRoleLost(newMember.guild, newMember.id, "role");
        }

        // Автоматически добавляем/удаляем хайков и чекеров во всех админ-ветках портфелей.
        const portfolioStaffRoleChanged =
            addedRoles.has(PERSONAL_REPORT_VIEW_ROLE_ID) ||
            addedRoles.has(PERSONAL_REPORT_HIGH_RANK_ROLE_ID) ||
            removedRoles.has(PERSONAL_REPORT_VIEW_ROLE_ID) ||
            removedRoles.has(PERSONAL_REPORT_HIGH_RANK_ROLE_ID);
        if (portfolioStaffRoleChanged) {
            await syncPortfolioAdminMemberInAllThreads(newMember);
        }

        if (addedRoles.size || removedRoles.size) {
            const roleAudit = await findRecentAuditEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
            await sendForumLog(newMember.guild, "roleUpdate", [
                `**Кто изменил:** ${formatAuditExecutor(roleAudit)}`,
                `**Кому изменили:** <@${newMember.id}> (${clipLogText(newMember.user.tag)})`,
                `**Выданы роли:** ${addedRoles.map(role => `<@&${role.id}>`).join(", ") || "нет"}`,
                `**Сняты роли:** ${removedRoles.map(role => `<@&${role.id}>`).join(", ") || "нет"}`
            ]);
        }

        // Условие: раньше ролей было больше одной, теперь осталась ТОЛЬКО 1458410670071615580 и больше ничего
        const wasMoreThanOne = oldRoles.size > 1;
        const nowOnlyDeductRole = newRoles.size === 1 && newRoles.has(DEDUCT_ROLE_ID);

        if (!wasMoreThanOne || !nowOnlyDeductRole) return;

        // Ищем рекрута, который принял этого участника
        const recruiterId = salary.recruits[newMember.id];
        if (!recruiterId) return;

        // Списываем 25к (не уходим в минус)
        salary.balances[recruiterId] = Math.max(0, (salary.balances[recruiterId] || 0) - 25000);
        await saveDB(salary);

        const config = SERVERS[newMember.guild.id];
        if (config) await updateSalaryEmbed(newMember.guild);

        // Уведомление в канал (осталась одна роль)
        const newBal2 = salary.balances[recruiterId] || 0;
        const notifyChannel2 = await newMember.guild.channels.fetch("1518544382985371698").catch(() => null);
        if (notifyChannel2) {
            await notifyChannel2.send({
                content: `⚠️ <@${recruiterId}>, с вашего баланса списано **$25,000** — у <@${newMember.id}> **осталась только одна роль**.
Ваш баланс: **$${newBal2.toLocaleString()}**`
            }).catch(() => null);
        }
    } catch (e) {
        console.error("[MEMBER UPDATE ERROR]", e);
    }
});


// =====================================================
// SHUTDOWN
// =====================================================
const shutdown = () => {
    console.log(`[BOT] [${INSTANCE_ID}] Получен сигнал выключения. Отключаюсь...`);
    client.destroy();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);


// =====================================================
// LOGIN
// =====================================================
connectDB().then(() => {
    client.login(process.env.TOKEN);
}).catch(err => {
    console.error("[DB] Ошибка подключения к MongoDB:", err);
    process.exit(1);
});
