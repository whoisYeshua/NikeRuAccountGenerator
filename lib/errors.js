class MajorLoginError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

class AccountExistsError extends MajorLoginError {
    constructor() {
        super('Аккаунт уже существует');
    }
}

class ReLoginError extends MajorLoginError {
    constructor() {
        super('Повторный вход не сработал');
    }
}

class MajorSmsError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

class BalanceError extends MajorSmsError {
    constructor(serviceName) {
        super(`Недостаточный баланс на ${serviceName}`);
        this.serviceName = serviceName;
    }
}

class StockError extends MajorSmsError {
    constructor(serviceName) {
        super(`Нет доступных номеров Nike на ${serviceName}`);
        this.serviceName = serviceName;
    }
}

class ConnectionError extends MajorSmsError {
    constructor(serviceName, responseText)  {
        super(`Причина ошибки на подключение к ${serviceName}: ${responseText}`);
        this.serviceName = serviceName;
        this.responseText = responseText;
    }
}

class MinorSmsError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

class BuyError extends MinorSmsError {
    constructor(serviceName) {
        super(`Ошибка покупки - какая-то ошибка на подключение к API ${serviceName}, либо проблема на стороне сервиса`);
        this.serviceName = serviceName;
    }
}

class WaitCodeError extends MinorSmsError {
    constructor(serviceName) {
        super(`Превышено время ожидания кода, отменили номер на ${serviceName}`);
        this.serviceName = serviceName;
    }
}

module.exports = {
    MajorLoginError,
    ReLoginError,
    AccountExistsError,
    MajorSmsError,
    BalanceError,
    StockError,
    ConnectionError,
    MinorSmsError,
    BuyError,
    WaitCodeError
};