const fetch = require('node-fetch');
const _colors = require('colors');
const config = require('../config.json');
const cheapSmsToken = config.cheapSms;
const smsActivate = config.smsActivate;
const getSmsToken = config.getSms;

const {BalanceError, StockError, ConnectionError, MinorSmsError, BuyError, WaitCodeError} = require('./errors')


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
                        await changeNumberStatus(service, id, service.cancelCode)
                        throw new WaitCodeError(service.hostname)
                    }
                } else {
                    await changeNumberStatus(service, id, service.completeCode)
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

async function changeNumberStatus(service, id, status) {
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

const delay = ms => new Promise(_ => setTimeout(_, ms));


module.exports = {
    service,
    accessToSmsService,
    checkAvailableNumbers,
    checkAvailableBalance,
    getNumber,
    getCode,
    checkNumberStatus,
    changeNumberStatus,
};