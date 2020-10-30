const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const LanguagePlugin = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages')
const fetch = require('node-fetch');
const fs = require('fs');
const autoenc = require('node-autodetect-utf8-cp1251-cp866');
const iconv = require('iconv-lite');
const neatCsv = require('neat-csv');
const cliProgress = require('cli-progress');
const _colors = require('colors');
const config = require('./config.json');

const filePath = 'csv/gs-accs.csv';
const releaseUrl = config.releaseUrl;
const webhookUrl = config.webhookUrl;

const lp = LanguagePlugin({languages: ['ru-RU', 'ru']})

const bar1 = new cliProgress.SingleBar({
    format: `Generator Progress | ${_colors.green('{bar}')} | {percentage}% || {value}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
})

async function create({mail, pass, firstName, lastName, middleName, addressLine1, addressLine2, city, postCode, phone, cardNumber, cardExpiry, cardCvc}) {

    let attempt = 0;
    const width = Math.floor(Math.random() * (1800 - 1025 + 1)) + 1025;
    const height = Math.floor(Math.random() * (1000 - 600 + 1)) + 600;
    const PUPPETEER_OPTIONS = {
        headless: false,
        slowMo: 150,
        defaultViewport: {
            width: width,
            height: height
        },
        args: [`--window-size=${width},${height}`]
    };

    puppeteer.use(lp)
    puppeteer.use(StealthPlugin())

    const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    const page = await browser.newPage();

    try {
        if (releaseUrl) {
            await page.goto('https://www.nike.com/ru/launch', {waitUntil: 'networkidle2'})
            await login()

            await page.goto(releaseUrl, {waitUntil: 'networkidle2'})
            await addDataToGsPage()
            await page.waitForNavigation({waitUntil: 'networkidle2'})
            await webhook('Данные сохранены')

            await browser.close();
        } else {
            throw new Error('releaseUrl не установлен')
        }

    } catch (e) {
        console.error(_colors.red(`\n${e}`))
        await webhook('Данные не сохранены')
        await browser.close();

    }

    async function login() {
        try {
            await page.waitForTimeout(1000)
            await page.click('li.member-nav-item.d-sm-ib.va-sm-m > button')
            await page.waitForTimeout(1000)
            await page.type('input[type="email"]', mail);
            await page.type('input[type="password"]', pass);
            await page.click('.loginSubmit  > input[type="button"]')
            await page.waitForTimeout(9000)
            if (await page.$('input[type="email"]')) {
                throw new Error;
            }
        } catch (e) {
            throw new Error('Не удалось войти в аккаунт')
        }
    }

    async function addDataToGsPage() {
        if (attempt < 2) {
            try {
                let url = await page.url();
                url = new URL(url)
                if (url.pathname === '/404' || url.pathname === '/error') {
                    throw new Error('Ошибка загрузи страницы')
                }
                await page.waitForSelector('#firstName');
                await page.type('#firstName', firstName);
                await page.type('#middleName', middleName);
                await page.type('#lastName', lastName);
                await page.type('#addressLine1', addressLine1);
                await page.type('#addressLine2', addressLine2);
                await page.type('#city', city);
                await page.waitForTimeout(500);

                await page.type('#postCode', postCode);
                await page.type('#phone > input[type="text"]', phone);
                await page.type('#email', mail);
                await page.waitForTimeout(500)

                await page.click('form > button.button-continue')
                await page.waitForTimeout(2000)

                const elementHandle = await page.$('iframe.newCard');
                const frame = await elementHandle.contentFrame();
                await frame.type('#cardNumber-input', cardNumber)
                await frame.type('#cardExpiry-input', cardExpiry)
                await frame.type('#cardCvc-input', cardCvc)
                await page.waitForTimeout(500)

                await page.click('div.storeForFutureUseCheckbox > label')
                await page.waitForTimeout(500)
                await page.click('div.categoryContinue > button.button-continue')
                await page.waitForTimeout(1000)

                await page.click('div.gdprConsentCheckbox > label')
                await page.waitForTimeout(1000)

                await page.click('.button-submit')
            } catch (e) {
                if (e.message === 'Ошибка загрузи страницы') {
                    attempt += 1;
                    await page.goto(releaseUrl, {waitUntil: 'networkidle2'});
                    await addDataToGsPage();
                } else {
                    throw e
                }
            }
        } else {
            throw new Error('Количество попыток на вход в gs.nike превышено')
        }
    }


    async function webhook(title) {
        if (webhookUrl) {
            let webhookData = createWebhookData(mail, pass, title)
            await sendWebhook(webhookUrl, webhookData)
        }
    }

}

function createWebhookData(mail, pass, title) {
    let color;
    if (title === 'Данные не сохранены') {
        color = 13239043;
    } else {
        color = 248362;
    }

    return {
        "embeds": [
            {
                "title": `${title}`,
                "description": `${mail} : ${pass}`,
                "color": color,
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

async function sendWebhook(webhookUrl, webhookData) {
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
        return `${response.status}`
    }
}

function getAcc() {
    let OPTIONS = {};

    return new Promise(function (resolve) {
        fs.readFile(filePath, async (err, data) => {
            if (err) {
                console.error(err)
                return
            }

            if (data.toString().indexOf(';') !== -1) {
                OPTIONS = {separator: ';'}
            }
            if (data.toString().indexOf('\t') !== -1) {
                OPTIONS = {separator: '\t'}
            }

            const str = iconv.decode(Buffer.from(data), autoenc.detectEncoding(data).encoding)
            const csvData = await neatCsv(str, OPTIONS)

            bar1.start(csvData.length, 0)

            for (let i in csvData) {
                bar1.update(parseInt(i))
                await create(csvData[i])
            }

            bar1.update(csvData.length)
            resolve('\nПроцесс завершен')
        })
    })
}

getAcc().then(value => {
    bar1.stop();
    console.log(_colors.green(`${value}`))
}).catch(e => {
    console.error(e)
    bar1.stop();
})