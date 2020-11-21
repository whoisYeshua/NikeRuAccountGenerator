const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const LanguagePlugin = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
const pluginProxy = require('puppeteer-extra-plugin-proxy');
const fs = require('fs');
const autoenc = require('node-autodetect-utf8-cp1251-cp866');
const iconv = require('iconv-lite');
const neatCsv = require('neat-csv');
const cliProgress = require('cli-progress');
const _colors = require('colors');
const {releaseUrl, webhookUrl} = require('./config.json');
const csvPath = 'csv/gs-accs.csv';

const {ReLoginError, NumberNotConfirmed} = require('./lib/errors')
const {createSuccessWebhookData, createUnsuccessWebhookData, sendWebhook} = require('./lib/discordWebhook')
const {getProxy} = require('./lib/getProxy')

const lp = LanguagePlugin({languages: ['ru-RU', 'ru']})
puppeteer.use(StealthPlugin())
puppeteer.use(lp)

const bar1 = new cliProgress.SingleBar({
    format: `Generator Progress | ${_colors.green('{bar}')} | {percentage}% || {value}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
})

async function create({mail, pass, firstName, lastName, middleName, addressLine1, addressLine2, city, postCode, phone, cardNumber, cardExpiry, cardCvc}, proxy) {
    let loginAttempts = 0;
    let gsAttempts = 0;
    const width = Math.floor(Math.random() * (1800 - 1025 + 1)) + 1025;
    const height = Math.floor(Math.random() * (1000 - 600 + 1)) + 600;
    const PUPPETEER_OPTIONS = {
        headless: false,
        slowMo: 75,
        defaultViewport: {width, height},
        args: [`--window-size=${width},${height}`]
    };

    if (proxy) {
        let {ip, port, username, password} = proxy;
        puppeteer.use(pluginProxy({
            address: ip,
            port: port,
            credentials: {
                username: username,
                password: password,
            }
        }));
    }

    const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    const page = await browser.newPage();

    cardExpiry = reformatExpiryDate(cardExpiry);

    try {
        if (releaseUrl) {
            await login()
            await addDataToGsPage()
            await page.waitForNavigation({waitUntil: 'networkidle2'})
            await successWebhook()

            await browser.close();
        } else {
            throw new Error('releaseUrl не установлен')
        }

    } catch (e) {
        console.error(_colors.red(`\n${e}`))
        await unsuccessWebhook(e.message)
        await browser.close();
        if (e instanceof ReLoginError) {
            console.log('Ждем 3 мин')
            await delay(180000)
        }
    }

    async function login() {
        try {
            await page.goto('https://www.nike.com/ru/login', {waitUntil: 'networkidle2'})
            await page.type('input[type="email"]', mail);
            await page.type('input[type="password"]', pass);
            await page.waitForTimeout(500);

            await page.click('.loginSubmit  > input[type="button"]')
            await page.waitForNavigation({waitUntil: 'networkidle2'})
        } catch (e) {
            if (e.name === 'TimeoutError') {
                await reLogin();
            } else {
                throw e;
            }
        }
    }

    async function addDataToGsPage() {
        await page.goto(releaseUrl, {waitUntil: 'networkidle2'});


        if (gsAttempts < 3) {
            try {
                let url = await page.url();
                url = new URL(url)
                if (url.pathname === '/404' || url.pathname === '/error') {
                    throw new Error('Ошибка загрузи страницы')
                }
                if (await page.$('div.sendCode > div.mobileNumber-div > input')) {
                    throw new NumberNotConfirmed()
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
                if (e.message === 'Ошибка загрузи страницы' || e.name === 'TimeoutError') {
                    gsAttempts += 1;
                    await addDataToGsPage();
                } else {
                    throw e
                }
            }
        } else {
            throw new Error('Количество попыток на вход в gs.nike превышено')
        }
    }

    async function reLogin() {
        try {
            loginAttempts++;
            await page.click('.nike-unite-error-close > input[type="button"]')
            await page.waitForTimeout(500)

            await page.type('input[type="password"]', pass);
            await page.waitForTimeout(500);

            await page.click('.loginSubmit > input[type="button"]')
            await page.waitForNavigation({waitUntil: 'networkidle2'})

        } catch (e) {
            if (e.name === 'TimeoutError' && loginAttempts < 4) {
                await reLogin();
            } else {
                throw new ReLoginError()
            }
        }
    }

    async function successWebhook() {
        if (webhookUrl) {
            let webhookData = createSuccessWebhookData(mail, pass, 'Данные сохранены')
            await sendWebhook(webhookUrl, webhookData)
        }
    }

    async function unsuccessWebhook(reason) {
        if (webhookUrl) {
            let webhookData = createUnsuccessWebhookData(mail, pass, 'Данные не сохранены', reason)
            await sendWebhook(webhookData)
        }
    }
}

function reformatExpiryDate(cardExpiry) {
    cardExpiry = cardExpiry.replace(/[\\\-\s/.,_|:]/g, '')
    if (cardExpiry.length === 3) {
        cardExpiry = `0${cardExpiry}`
    }
    return cardExpiry
}

function getAcc() {
    let OPTIONS = {};

    return new Promise(function (resolve) {
        fs.readFile(csvPath, async (err, data) => {
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
            const proxies = await getProxy()

            bar1.start(csvData.length, 0)

            for (let i in csvData) {
                bar1.update(parseInt(i))
                if (proxies.length) {
                    let proxy = proxies[i % proxies.length]
                    await create(csvData[i], proxy)
                } else {
                    await create(csvData[i])
                }
            }

            bar1.update(csvData.length)
            resolve('Процесс завершен')
        })
    })
}

const delay = ms => new Promise(_ => setTimeout(_, ms));

getAcc().then(value => {
    bar1.stop();
    console.log(_colors.green(`\n\n${value}`))
}).catch(e => {
    console.error(e)
    bar1.stop();
})