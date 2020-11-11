const _colors = require('colors');
const fetch = require('node-fetch');
const config = require('../config.json');
const webhookUrl = config.webhookUrl;

function createSuccessWebhookData(mail, pass, title) {
    return {
        "embeds": [
            {
                "title": title,
                "description": `${mail} : ${pass}`,
                "color": 248362,
                "footer": {
                    "text": "NikeRuAccGen"
                },
                "timestamp": `${new Date().toISOString()}`
            }
        ],
        "username": "NikeRuAccountGenerator",
        "avatar_url": "https://i.imgur.com/83hGFEg.png"
    }
}

function createUnsuccessWebhookData(mail, pass, title, reason) {
    let color;
    if (title === 'Аккаунт не создан') {
        color = 13239043
    } else {
        color = 16245504;
    }
    return {
        "embeds": [
            {
                "title": `${title}`,
                "description": `${mail} : ${pass}`,
                "color": `${color}`,
                "fields": [
                    {
                        "name": "Причина",
                        "value": `\`${reason}\``
                    }
                ],
                "footer": {
                    "text": "NikeRuAccGen"
                },
                "timestamp": `${new Date().toISOString()}`
            }
        ],
        "username": "NikeRuAccountGenerator",
        "avatar_url": "https://i.imgur.com/83hGFEg.png"
    }
}

async function sendWebhook(webhookData) {
    try {
        let response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify(webhookData)
        })

        if (response.ok) {
            return 'Вебхук отправлен'
        } else {
            throw new Error(`Webhook не отправлен, статус - ${response.status}`)
        }
    } catch (e) {
        console.error(_colors.red(`\n${e.message}`))
    }
}

module.exports = {
    createSuccessWebhookData,
    createUnsuccessWebhookData,
    sendWebhook
}