const assert = require('assert');

const str = [
    "02\\28",
    "02-28",
    "02 28",
    "02/28",
    "02.28",
    "02,28",
    "02_28",
    "02|28",
    "02:28",
    "228",
];


function reformatExpiryDate(cardExpiry) {
    cardExpiry = cardExpiry.replace(/[\\\-\s/.,_|:]/g, '')
    if (cardExpiry.length === 3) {
        cardExpiry = `0${cardExpiry}`
    }
    return cardExpiry
}

describe("Форматирование даты к правильному формату", function() {
    for (let date of str) {
        it(`Форматирование даты ${date} выдаст 0228`, function() {
            assert.strictEqual(reformatExpiryDate(date), '0228');
        });
    }
});