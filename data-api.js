const { RDSDataService } = require('aws-sdk/index');
const Promise = require('sequelize/lib/promise');
const forEach = require('lodash/forEach');
const moment = require('moment');

const includeResultMetadata = true;

/*
 * https://docs.aws.amazon.com/pt_br/AmazonRDS/latest/AuroraUserGuide/data-api.html
 */

const parserDictionary = {
  BIT: column => column.isNull ? null : column.booleanValue,
  BOOLEAN: column => column.isNull ? null : column.booleanValue,

  VARCHAR: column => column.isNull ? null : column.stringValue,
  DATETIME: column => column.isNull ? null : moment.utc(column.stringValue).toDate().toISOString(),
  TEXT: column => column.isNull ? null : column.stringValue,

  BIGINT: column => column.isNull ? null : column.longValue,
  INT: column => column.isNull ? null : column.longValue,
  TINYINT: column => column.isNull ? null : column.longValue,
  SMALLINT: column => column.isNull ? null : column.longValue,
  INTEGER: column => column.isNull ? null : column.longValue,
  DECIMAL: column => {
    if (column.isNull) return null;
    return column.longValue !== undefined ? column.longValue : column.doubleValue;
  },

  FLOAT: column => column.isNull ? null : column.doubleValue,
  REAL: column => column.isNull ? null : column.doubleValue,
  DOUBLE: column => column.isNull ? null : column.doubleValue,
};
const defaultParser = column => column.stringValue;

function getParser(type) {
  return parserDictionary[type] || defaultParser;
}

function createParsers(columnMetadata) {
  const parsers = [];
  forEach(columnMetadata, metadata => {
    parsers.push((object, column) => {
      object[metadata.label] = getParser(metadata.typeName)(column);
    });
  });
  return parsers;
}

const createParser = columnMetadata => {
  const parsers = createParsers(columnMetadata);
  return record => {
    const object = {};
    forEach(record, (column, index) => parsers[index](object, column));
    return object;
  }
};

const parseResult = data => {
  const { columnMetadata, numberOfRecordsUpdated, records, generatedFields } = data;

  if (!columnMetadata || !records) {
    const insertId = generatedFields && generatedFields.length ? generatedFields[0].longValue : 0;

    return {
      fieldCount: 0,
      affectedRows: numberOfRecordsUpdated,
      insertId,
      info: '',
      serverStatus: 2,
      warningStatus: 0,
    };
  }

  const parser = createParser(columnMetadata);
  return records.map(parser);
};

const paramsPrefix = 'parameter'

function getValueFromParam(param) {
  if (param === null || param === undefined) {
    return { isNull: true }
  }
  const type = typeof param;
  switch (type) {
    case 'boolean': return { isNull: false, booleanValue: param };
    case 'number': return { isNull: false, longValue: param };
    case 'string': return { isNull: false, stringValue: param };
    default: throw new Error('nunca nem vi');
  }
}

function applyParams(sql, params) {
  if (!params) return { sql };

  let index = 0;
  const parameters = [];
  const newSql = sql.replace(/\?/g, function () {
    const paramName = `${paramsPrefix}_${index}`;
    parameters.push({
      name: paramName,
      value: getValueFromParam(params[index])
    });
    index++;
    return `:${paramName}`;
  });

  return { sql: newSql, parameters };
}

class DataApi {
  constructor({ resourceArn, secretArn, database, region }) {
    this.resourceArn = resourceArn;
    this.secretArn = secretArn;
    this.database = database;
    this.rdsdataservice = new RDSDataService({ region });
  }

  executeQuery(rawSql, sqlParams, transactionId) {
    const { sql, parameters } = applyParams(rawSql, sqlParams);
    const { resourceArn, secretArn, database } = this;
    const params = { secretArn, resourceArn, sql, parameters, database, includeResultMetadata, transactionId };
    return new Promise((resolve, reject) => {
      this.rdsdataservice.executeStatement(params, (err, data) => {
        if (err) reject(err); // TODO precisamos converter o erro para algo MySQL
        else     resolve(parseResult(data));
      });
    });
  };

  beginTransaction() {
    const { resourceArn, secretArn, database } = this;
    const params = { secretArn, resourceArn, database };
    return new Promise((resolve, reject) => {
      this.rdsdataservice.beginTransaction(params, (err, data) => {
        if (err) reject(err);
        else     resolve(data);
      });
    });
  };

  commitTransaction(transactionId) {
    const { resourceArn, secretArn } = this;
    const params = { secretArn, resourceArn, transactionId };
    return new Promise((resolve, reject) => {
      this.rdsdataservice.commitTransaction(params, (err, data) => {
        if (err) reject(err);
        else     resolve(data);
      });
    });
  };

  rollbackTransaction(transactionId) {
    const { resourceArn, secretArn } = this;
    const params = { secretArn, resourceArn, transactionId };
    return new Promise((resolve, reject) => {
      this.rdsdataservice.rollbackTransaction(params, (err, data) => {
        if (err) reject(err);
        else     resolve(data);
      });
    });
  };
}

let id = 0;

class DataApiConnection {

  constructor(dataAPI, verbose) {
    this.dataAPI = dataAPI;

    this.id = id++;
    this.stream = {};
    this.log = log => verbose && console.log(log);
    this.log('NEW CONNECTION! ' + this.id);
  }

  end(fn) {
    this.log('CLOSING CONNECTION! ' + this.id);
    delete this.transactionId;
    fn();
  }

  execute(sql, parameters, handler) {
    this.log(`[${this.id}][${this.transactionId}]: ${sql}`);
    return this._executeQuery(sql, parameters, handler);
  }

  query({ sql }, handler) {
    this.log(`[${this.id}][${this.transactionId}]: ${sql}`);
    return this._executeQuery(sql, null, handler);
  }

  beginTransaction() {
    this.log(`[${this.id}] START TRANSACTION;`);
    return this.dataAPI.beginTransaction().then(({ transactionId }) => {
      this.transactionId = transactionId;
      return transactionId;
    });
  }

  commitTransaction(transactionId) {
    this.log(`[${this.id}] COMMIT;`);
    return this.dataAPI.commitTransaction(transactionId).then(() => {
      delete this.transactionId;
    });
  }

  rollbackTransaction(transactionId) {
    this.log(`[${this.id}] ROLLBACK;`);
    return this.dataAPI.rollbackTransaction(transactionId).then(() => {
      delete this.transactionId;
    });
  }

  _executeQuery(sql, parameters, handler) {
    this.dataAPI.executeQuery(sql, parameters, this.transactionId)
      .then(result => handler(null, result))
      .catch(err => handler(err));
    return { setMaxListeners: () => {} };
  }
}

exports.DataApi = DataApi;
exports.DataApiConnection = DataApiConnection;