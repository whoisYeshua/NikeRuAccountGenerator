const fs = require('fs');
const os = require('os');


function getProxy(proxyPath = 'proxy.txt') {
    return new Promise(function (resolve) {
        fs.readFile(proxyPath, 'utf-8', function (err, data) {
            try {
                if (err) throw err;
                if (data !== '') {
                    resolve(formatProxy(data))
                } else {
                    throw new Error('Empty proxy list')
                }
            } catch (e) {
                resolve ([])
            }
        });
    })
}

function formatProxy(data) {
    let formattedProxyList = [];
    let proxies = data.split(os.EOL)
    proxies = proxies.filter(el => {
        return el !== ''
    })
    for (let proxy of proxies) {
        proxy = proxy.replace(/[\s]/g, '')
        let [ip, port, username, password] = proxy.split(':')
        proxy = {
            ip: ip,
            port: port,
            username: username,
            password: password
        }
        formattedProxyList.push(proxy)
    }
    return formattedProxyList
}

module.exports = {
    getProxy
};