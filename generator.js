const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const LanguagePlugin = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages')
const fetch = require('node-fetch');
const fs = require('fs');
const neatCsv = require('neat-csv');
const cliProgress = require('cli-progress');
const _colors = require('colors');
const config = require('./config.json');

const filePath = 'csv/accs.csv';
const smsToken = config.smsToken;
const webhookUrl = config.webhookUrl;

const lp = LanguagePlugin({languages: ['ru-RU', 'ru']})

const bar1 = new cliProgress.SingleBar({
    format: `Generator Progress | ${_colors.green('{bar}')} | {percentage}% || {value}/{total}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591'
})


async function create({mail, pass, firstName, lastName, birthday, gender}) {
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
        await page.goto('https://www.nike.com/ru/launch')

        // console.log({mail, pass, firstName, lastName, birthday, gender})
        await registration()
        await setMobile()
        await browser.close();

    } catch (e) {
        console.error(_colors.red(`${e}`))
        await webhook('Аккаунт не создан')
        await browser.close();

    }

    async function registration() {
        try {
            await page.waitForTimeout(1000)
            await page.click('li.member-nav-item.d-sm-ib.va-sm-m > button')
            await page.click('.loginJoinLink.current-member-signin > a');
            await page.waitForTimeout(2000);

            await page.type('input[type="email"]', mail);
            await page.type('input[type="password"]', pass);
            await page.type('.firstName.nike-unite-component.empty > input[type="text"]', firstName);
            await page.type('.lastName.nike-unite-component.empty > input[type="text"]', lastName);
            await page.type('input[type="date"]', birthday);
            if (gender === 'M') {
                await page.click('li:nth-child(1) > input[type="button"]')
            } else {
                await page.click('li:nth-child(2) > input[type="button"]')
            }
            await page.click('.checkbox')
            await page.waitForTimeout(500);

            await page.click('.joinSubmit.nike-unite-component > input[type="button"]')
            await page.waitForTimeout(9000)
        } catch (e) {
            throw new Error('Аккаунт не создан')
        }
    }

    async function setMobile() {
        if (smsToken && attempt < 3) {
            try {
                await page.goto('https://www.nike.com/ru/member/settings')
                await page.waitForTimeout(8000)

                await page.click('.mex-mobile-phone > div > div > button')
                let [id, number] = await accessToCheapSms()

                await page.type('div.sendCode > div.mobileNumber-div > input', number)
                await page.click('#nike-unite-progressiveForm > div > div > input[type="button"]')
                let code = await getCode(id)

                await page.type('.verifyCode > input', code)
                await page.click('label.checkbox')
                await page.waitForTimeout(500)

                await page.click('#nike-unite-progressiveForm > div > input[type="button"]')
                await page.waitForTimeout(2000)

                await webhook('Аккаунт создан')
                // Раскомментируй эти строки и создай в этой директории папку screenshots, если нужно чтобы скрипт сохранял скрины
                // const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-')
                // const atPosition = mail.indexOf('@')
                // await page.screenshot({path: `screenshots/screen-${time}-${mail.slice(0, atPosition)}.png`})
            } catch (e) {
                console.error(_colors.red(`\n${e}`))
                attempt += 1;
                await setMobile();
            }
        } else {
            await webhook('Аккаунт создан, но номер телефона не подтвержден')
        }
    }

    async function webhook(title) {
        if (webhookUrl) {
            let webhookData = createWebhookData(mail, pass, title)
            await sendWebhook(webhookUrl, webhookData)
        }
    }

}

async function accessToCheapSms() {
    if (await checkAvailableNumbers() && await checkAvailableBalance()) {
        return await getNumber()
    }
}

function getCode(id) {
    let delay = 20000;
    let start = Date.now();
    return new Promise((resolve, reject) => {
        let timerId = setTimeout(async function checkCode() {
            try {
                let code = await checkNumberStatus(id);
                if (code === 'Ожидание смс') {
                    if (Date.now() - start < 180000) {
                        delay += 10000;
                        timerId = setTimeout(checkCode, delay);
                    } else {
                        await ChangeNumberStatus(id, -1)
                        reject('Превышено время ожидания, отменяем номер')
                    }
                } else {
                    await ChangeNumberStatus(id, 6)
                    resolve(code)
                }
            } catch (e) {
                reject(e.message)
            }
        }, delay)
    })
}

async function checkAvailableBalance() {
    let response = await fetch(`http://cheapsms.pro/stubs/handler_api.php?api_key=${smsToken}&action=getBalance`)
    let responseText = await response.text()
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL') {
        throw new Error(`Причина ошибки на подключение к cheapsms: ${responseText}`)
    } else {
        if (parseInt(responseText.slice(15)) > 1) {
            return true
        } else {
            throw new Error('Недостаточный баланс')
        }
    }
}

async function checkAvailableNumbers() {
    let response = await fetch(`http://cheapsms.pro/stubs/handler_api.php?api_key=${smsToken}&action=getNumbersStatus&country=$country`)
    let responseText = await response.text()
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL') {
        throw new Error(`Причина ошибки на подключение к cheapsms: ${responseText}`)
    } else {
        let numStock = JSON.parse(responseText)
        if (numStock['nk_0'] > 0) {
            return true
        } else {
            throw new Error('Нет доступных номеров Nike, поменяйте проверку на доступность номеров и запрос на Сервис: \"Нет в списке\" - ot_0 ')
        }
    }
}

async function getNumber() {
    let response = await fetch(`http://cheapsms.pro/stubs/handler_api.php?api_key=${smsToken}&action=getNumber&service=nk_0`);
    let responseText = await response.text();
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL') {
        throw new Error(`Причина ошибки на подключение к cheapsms: ${responseText}`)
    } else {
        if (responseText === 'NO_NUMBERS') {
            throw new Error('Нет доступных номеров Nike, поменяйте проверку на доступность номеров и запрос на Сервис: \"Нет в списке\" - ot_0 ');
        } else if (responseText === 'NO_BALANC') {
            throw new Error('Недостаточный баланс')
        } else if (responseText === 'Ошибка покупки') {
            throw new Error('Ошибка покупки - какая-то ошибка на подключение к API, либо проблема на стороне сервиса')
        } else {
            let [, id, number] = responseText.split(':')
            number = number.slice(2)
            return [id, number]
        }
    }
}

async function checkNumberStatus(id) {
    let response = await fetch(`http://cheapsms.pro/stubs/handler_api.php?api_key=${smsToken}&action=getStatus&id=${id}`);
    let responseText = await response.text();
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'NO_ACTIVATION') {
        throw new Error(`Ошибка от сервиса: ${responseText}`)
    } else {
        if (responseText === 'STATUS_WAIT_CODE') {
            return 'Ожидание смс'
        } else if (responseText === 'STATUS_CANCEL') {
            console.log('Активация отменена')
        } else {
            let [, code] = responseText.split(':')
            return code
        }
    }
}

async function ChangeNumberStatus(id, status) {
    let response = await fetch(`http://cheapsms.pro/stubs/handler_api.php?api_key=${smsToken}&action=setStatus&status=${status}&id=${id}&forward=$forward`);
    let responseText = await response.text();
    if (responseText === 'BAD_KEY' || responseText === 'ERROR_SQL' || responseText === 'NO_ACTIVATION' || responseText === 'BAD_STATUS') {
        throw new Error(`Ошибка от сервиса: ${responseText}`)
    } else {
        if (responseText === 'ACCESS_ACTIVATION') {
            console.log('\nСервис успешно активирован')
        } else if (responseText === 'ACCESS_CANCEL') {
            console.log('\nАктивация отменена')
        } else {
            // console.log(responseText)
        }
    }
}

function createWebhookData(mail, pass, title) {
    let color;
    if (title === 'Аккаунт не создан') {
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

            const csvData = await neatCsv(data, OPTIONS)

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