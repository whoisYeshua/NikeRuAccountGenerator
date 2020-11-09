const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const LanguagePlugin = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
const pluginProxy = require('puppeteer-extra-plugin-proxy');
const fetch = require('node-fetch');
const fs = require('fs');
const autoenc = require('node-autodetect-utf8-cp1251-cp866');
const iconv = require('iconv-lite');
const neatCsv = require('neat-csv');
const cliProgress = require('cli-progress');
const _colors = require('colors');
const config = require('./config.json');
const cheapSmsToken = config.cheapSms;
const smsActivate = config.smsActivate;
const getSmsToken = config.getSms;
const webhookUrl = config.webhookUrl;
const csvPath = 'csv/accs.csv';
const proxyPath = 'proxy.txt';

const {MajorLoginError, ReLoginError, AccountExistsError, MajorSmsError, BalanceError, StockError, ConnectionError, MinorSmsError, BuyError, WaitCodeError} = require('./lib/errors')

const lp = LanguagePlugin({languages: ['ru-RU', 'ru']})
puppeteer.use(StealthPlugin())
puppeteer.use(lp)

const bar1 = new cliProgress.SingleBar({
    format: `Generator Progress | ${_colors.green('{bar}')} | {percentage}% || {value}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591'
})

let service = [];
if (cheapSmsToken) {
    service.push({
        hostname: 'cheapsms.pro',
        product: 'nk',
        requiredNumbers: 5,
        price: 1,
        prefixLength: 2,
        cancelCode: -1,
        completeCode: 6,
        token: cheapSmsToken
    })
}
if (smsActivate) {
    service.push({
        hostname: 'sms-activate.ru',
        product: 'ew',
        requiredNumbers: 1,
        price: 6,
        prefixLength: 1,
        cancelCode: 8,
        completeCode: 6,
        token: smsActivate
    })
}
if (getSmsToken) {
    service.push({
        hostname: 'api.getsms.online',
        product: 'ot',
        requiredNumbers: 1,
        price: 2,
        prefixLength: 2,
        cancelCode: -1,
        completeCode: 6,
        token: getSmsToken
    })
}

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
        if (e instanceof AccountExistsError) {
            await webhook(e.message)
        } else {
            await webhook('Аккаунт не создан')
        }
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

                await webhook('Аккаунт создан')
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
                await webhook('Аккаунт создан, но номер телефона не подтвержден')
            }
        }
    }

    async function webhook(title) {
        if (webhookUrl) {
            let webhookData = createWebhookData(mail, pass, title)
            await sendWebhook(webhookUrl, webhookData)
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

async function accessToSmsService(service) {
    try {
        if (await Promise.all([
            checkAvailableNumbers(service[0]),
            checkAvailableBalance(service[0])
        ])) {
            return await getNumber(service[0])
        }
    } catch (e) {
        console.error(_colors.red(`\n${e.message}`));
        if (e instanceof MinorSmsError) {
            await delay(5000);
            return await accessToSmsService(service)
        } else {
            service.shift();
            if (service.length > 0) {
                return await accessToSmsService(service)
            } else {
                throw new Error('Все указанные SMS сервисы недоступны');
            }
        }
    }
}

async function checkAvailableBalance(service) {
    let response = await fetch(`http://${service.hostname}/stubs/handler_api.php?api_key=${service.token}&action=getBalance`)
    let responseText = await response.text()
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'BAD_ACTION' || responseText === 'NO_ACTION' || responseText === 'NO_KEY') {
        throw new ConnectionError(service.hostname, responseText);
    } else {
        if (parseInt(responseText.slice(15)) > service.price) {
            return true
        } else {
            throw new BalanceError(service.hostname);
        }
    }
}

async function checkAvailableNumbers(service) {
    let response = await fetch(`http://${service.hostname}/stubs/handler_api.php?api_key=${service.token}&action=getNumbersStatus&country=ru`)
    let responseText = await response.text()
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'BAD_ACTION' || responseText === 'NO_ACTION' || responseText === 'NO_KEY') {
        throw new ConnectionError(service.hostname, responseText)
    } else {
        let numStock = JSON.parse(responseText);
        if (numStock[`${service.product}_0`] >= service.requiredNumbers) {
            return true
        } else {
            throw new StockError(service.hostname);
        }
    }
}

async function getNumber(service) {
    let response = await fetch(`http://${service.hostname}/stubs/handler_api.php?api_key=${service.token}&action=getNumber&service=${service.product}`);
    let responseText = await response.text();
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'BAD_ACTION' || responseText === 'NO_ACTION' || responseText === 'NO_KEY' ||
        responseText === 'BAD_SERVICE' || responseText === 'BAD_COUNTRY') {
        throw new ConnectionError(service.hostname, responseText);
    } else if (responseText === 'NO_NUMBERS' || responseText === 'NO_NUMBER') {
        throw new BalanceError(service.hostname);
    } else if (responseText === 'NO_BALANC' || responseText === 'NO_MEANS') {
        throw new StockError(service.hostname);
    } else if (responseText === 'Ошибка покупки') {
        throw new BuyError(service.hostname);
    } else if (responseText.split(':')[0] === 'ACCESS_NUMBER') {
        let [, id, number] = responseText.split(':');
        number = number.slice(service.prefixLength);
        return [id, number]
    } else {
        throw new Error(`Ошибка на ${service.hostname} - ${responseText}`)
    }
}

function getCode(service, id) {
    let timerDelay = 20000;
    let start = Date.now();
    return new Promise((resolve, reject) => {
        let timerId = setTimeout(async function checkCode() {
            try {
                let code = await checkNumberStatus(service, id);
                if (code === 'Ожидание смс') {
                    if (Date.now() - start < 180000) {
                        timerDelay += 10000;
                        timerId = setTimeout(checkCode, timerDelay);
                    } else {
                        await ChangeNumberStatus(service, id, service.cancelCode)
                        throw new WaitCodeError(service.hostname)
                    }
                } else {
                    await ChangeNumberStatus(service, id, service.completeCode)
                    resolve(code)
                }
            } catch (e) {
                reject(e)
            }
        }, timerDelay)
    })
}

async function checkNumberStatus(service, id) {
    let response = await fetch(`http://${service.hostname}/stubs/handler_api.php?api_key=${service.token}&action=getStatus&id=${id}`);
    let responseText = await response.text();
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'NO_ACTIVATION' || responseText === 'BAD_STATUS') {
        throw new ConnectionError(service.hostname, responseText);
    } else if (responseText === 'STATUS_WAIT_CODE') {
        return 'Ожидание смс'
    } else if (responseText === 'STATUS_CANCEL') {
        throw new Error(`${service.hostname}: Активация отменена`)
    } else if (responseText === 'STATUS_ERROR_NUMBER') {
        throw new Error(`Ошибка от сервиса ${service.hostname}: Проблемы с номером`)
    } else if (responseText === 'STATUS_ERROR_SERVICE') {
        throw new Error(`Ошибка от сервиса ${service.hostname}: SMS приходят не от того сервиса, что заказан. Активация отменена`)
    } else if (responseText.split(':')[0] === 'STATUS_OK') {
        let [, code] = responseText.split(':')
        return code
    } else {
        throw new Error(`Ответ от сервиса ${service.hostname}: ${responseText}`)
    }
}

async function ChangeNumberStatus(service, id, status) {
    let response = await fetch(`http://${service.hostname}/stubs/handler_api.php?api_key=${service.token}&action=setStatus&status=${status}&id=${id}`);
    let responseText = await response.text();
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'NO_ACTIVATION' || responseText === 'BAD_STATUS') {
        console.log(`\nОшибка от сервиса ${service.hostname} при попытке отмены \ подтверждения номера: ${responseText} - не влияет на функционал`)
    } else if (responseText === 'ACCESS_ACTIVATION') {
        // console.log('\nСервис успешно активирован')
    } else if (responseText === 'ACCESS_CANCEL') {
        // console.log('\nАктивация отменена')
    }
}

function createWebhookData(mail, pass, title) {
    let color;
    if (title === 'Аккаунт не создан' || title === 'Аккаунт уже существует') {
        color = 13239043;
    } else if (title === 'Аккаунт создан') {
        color = 248362;
    } else {
        color = 16245504;
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