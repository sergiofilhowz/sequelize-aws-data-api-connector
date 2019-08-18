const { DataApiConnection, DataApi } = require('./data-api');

function extendFunction(object, property, subfunction) {
  const func = object[property];
  object[property] = function () {
    const suuper = function () {
      return func.apply(object, arguments);
    };
    return subfunction(suuper, ...arguments);
  }
}

function enableDataAPI(sequelize, { resourceArn, secretArn, database, region, verbose }) {
  const dataAPI = new DataApi({ resourceArn, secretArn, database, region });

  extendFunction(sequelize.connectionManager, 'connect', async () => new DataApiConnection(dataAPI, verbose));
  extendFunction(sequelize, 'getQueryInterface', (suuper) => {
    const queryInterface = suuper();
    extendFunction(queryInterface, 'startTransaction', (suuper, transaction) => {
      return transaction.connection.beginTransaction().then(transactionId => {
        transaction.id = transactionId;
      });
    });
    extendFunction(queryInterface, 'commitTransaction', (suuper, transaction) => {
      return transaction.connection.commitTransaction(transaction.id);
    });
    extendFunction(queryInterface, 'rollbackTransaction', (suuper, transaction) => {
      return transaction.connection.rollbackTransaction(transaction.id);
    });
    return queryInterface;
  });
}

exports.enableDataAPI = enableDataAPI;