const assert = require('assert');
const {getProxy} = require('../lib/getProxy')


const correctProxyList = [
    {
        ip: "127.0.0.1",
        port: "2000",
        username: "testprof",
        password: "testpass",
    },
    {
        ip: "127.0.0.2",
        port: "2000",
        username: "testprof",
        password: "testpass",
    },
    {
        ip: "127.0.0.3",
        port: "2000",
        username: "testprof",
        password: "testpass",
    }
];

describe("getProxy()", function () {
    it(`Полученные прокси должны быть не пустыми и в правильном формате`, async function () {
        const formattedProxyList = await getProxy('./test/testProxy.txt')
        assert.deepStrictEqual(formattedProxyList, correctProxyList);
    });
});