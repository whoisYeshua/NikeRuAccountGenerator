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
const config = require('./config.json');
const webhookUrl = config.webhookUrl;
const csvPath = 'csv/accs.csv';
const proxyPath = 'proxy.txt';

const {ReLoginError, AccountExistsError, MinorSmsError} = require('./lib/errors')
const {createSuccessWebhookData, createUnsuccessWebhookData, sendWebhook} = require('./lib/discordWebhook')
const {service, accessToSmsService, getCode} = require('./lib/smsAPI')

const lp = LanguagePlugin({languages: ['ru-RU', 'ru']})
puppeteer.use(StealthPlugin())
puppeteer.use(lp)

const bar1 = new cliProgress.SingleBar({
    format: `Generator Progress | ${_colors.green('{bar}')} | {percentage}% || {value}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591'
})


async function create({mail, pass, firstName, lastName, birthday, gender}, proxy) {
    let joinAttempts = 0;
    let phoneAttempts = 0;
    let copyService = Object.assign([], service);
    const width = Math.floor(Math.random() * (1800 - 1025 + 1)) + 1025;
    const height = Math.floor(Math.random() * (1000 - 600 + 1)) + 600;
    const PUPPETEER_OPTIONS = {
        headless: false,
        slowMo: 75,
        defaultViewport: {
            width: width,
            height: height
        },
        args: [`--window-size=${width},${height}`]
    };

    if (proxy) {
        let {proxyIp, proxyPort, proxyUsername, proxyPassword} = proxy;
        puppeteer.use(pluginProxy({
            address: proxyIp,
            port: proxyPort,
            credentials: {
                username: proxyUsername,
                password: proxyPassword,
            }
        }));
    }

    const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    const page = await browser.newPage();

    try {
        await page.goto('https://www.nike.com/ru/login', {waitUntil: 'networkidle2'})

        await registration()
        await setMobile()
        await browser.close();

    } catch (e) {
        console.error(_colors.red(`\n${e}`))
        await unsuccessWebhook(e.message)
        await browser.close();
        if (e instanceof ReLoginError) {
            console.log('Ждем 3 мин')
            await delay(180000)
        }
    }

    async function registration() {
        try {
            await page.click('.loginJoinLink.current-member-signin > a');
            await page.waitForTimeout(2000);

            await page.type('input[type="email"]', mail);
            await page.type('input[type="password"]', pass);
            if (await page.$eval('.duplicate-email', el => el.style.display) === 'block') {
                throw new AccountExistsError();
            }
            await page.type('.firstName.nike-unite-component.empty > input[type="text"]', firstName);
            await page.type('.lastName.nike-unite-component.empty > input[type="text"]', lastName);
            await page.type('input[type="date"]', birthday);
            if (gender === 'M') {
                await page.click('li:nth-child(1) > input[type="button"]');
            } else {
                await page.click('li:nth-child(2) > input[type="button"]');
            }
            await page.click('.checkbox');
            await page.waitForTimeout(500);

            await page.click('.joinSubmit.nike-unite-component > input[type="button"]')
            await page.waitForNavigation({waitUntil: 'networkidle2'})

        } catch (e) {
            if (e.name === 'TimeoutError') {
                await reLogin();
            } else {
                throw e;
            }
        }
    }

    async function setMobile() {
        try {
            if (copyService.length > 0 && phoneAttempts < 3) {
                await page.goto('https://www.nike.com/ru/member/settings', {waitUntil: 'networkidle2'})

                await page.waitForSelector('.mex-mobile-phone > div > div > button')
                await page.click('.mex-mobile-phone > div > div > button')
                let [id, number] = await accessToSmsService(copyService);

                await page.type('div.sendCode > div.mobileNumber-div > input', number)
                await page.click('#nike-unite-progressiveForm > div > div > input[type="button"]')
                let code = await getCode(copyService[0], id)

                await page.type('.verifyCode > input', code)
                await page.click('label.checkbox')
                await page.waitForTimeout(500)

                await page.click('#nike-unite-progressiveForm > div > input[type="button"]')
                await page.waitForTimeout(2000)

                await successWebhook()
            } else {
                if (phoneAttempts >= 3) {
                    throw new Error('Превышено количество попыток ввода номера')
                } else if (copyService.length < 1) {
                    throw new Error('API ключи для SMS сервисов не установлены')
                }
            }
        } catch (e) {
            console.error(_colors.red(`\n${e.message}`))
            if (e instanceof MinorSmsError || e.name === 'TimeoutError') {
                phoneAttempts += 1;
                await setMobile();
            } else {
                // Раскомментируй эти строки и создай в этой директории папку screenshots, если нужно чтобы скрипт сохранял скрины
                // const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-')
                // const atPosition = mail.indexOf('@')
                // await page.screenshot({path: `screenshots/screen-${time}-${mail.slice(0, atPosition)}.png`})
                await semisuccessWebhook(e.message)
            }
        }
    }

    async function successWebhook() {
        if (webhookUrl) {
            let webhookData = createSuccessWebhookData(mail, pass, 'Аккаунт создан')
            await sendWebhook(webhookUrl, webhookData)
        }
    }

    async function semisuccessWebhook(reason) {
        if (webhookUrl) {
            let webhookData = createUnsuccessWebhookData(mail, pass, 'Аккаунт создан, но номер телефона не подтвержден', reason)
            await sendWebhook(webhookData)
        }
    }

    async function unsuccessWebhook(reason) {
        if (webhookUrl) {
            let webhookData = createUnsuccessWebhookData(mail, pass, 'Аккаунт не создан', reason)
            await sendWebhook(webhookData)
        }
    }

    async function reLogin() {
        try {
            joinAttempts++;
            await page.click('.nike-unite-error-close > input[type="button"]')
            await page.waitForTimeout(500)

            await page.click('.checkbox')
            await page.waitForTimeout(500);

            await page.click('.joinSubmit.nike-unite-component > input[type="button"]')
            await page.waitForNavigation({waitUntil: 'networkidle2'})
            
        } catch (e) {
            if (e.name === 'TimeoutError' && joinAttempts < 4) {
                await reLogin();
            } else {
                throw new ReLoginError()
            }
        }
    }
}

function getProxy(i) {
    return new Promise(function (resolve, reject) {
        fs.readFile(proxyPath, function (err, data) {
            if (err) throw err;

            const str = iconv.decode(Buffer.from(data), autoenc.detectEncoding(data).encoding)
            if (str !== '') {
                let proxies = str.toString().split('\r\n')
                let [proxyIp, proxyPort, proxyUsername, proxyPassword] = proxies[i % proxies.length].split(':')
                let proxy = {
                    proxyIp: proxyIp,
                    proxyPort: proxyPort,
                    proxyUsername: proxyUsername,
                    proxyPassword: proxyPassword
                }
                resolve(proxy)
            } else {
                reject()
            }
        });
    })
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

            bar1.start(csvData.length, 0)

            for (let i in csvData) {
                bar1.update(parseInt(i))
                try {
                    const proxy = await getProxy(i)
                    await create(csvData[i], proxy)
                } catch {
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