# AWS Data API connector for Sequelize

## Install
You will need Sequelize

```
$ yarn add sequelize
$ yarn add sequelize-aws-data-api-connector --save
```

## Usage

```javascript
import { enableDataAPI } from 'sequelize-aws-data-api-connector';

const sequelize = new Sequelize(); // your sequelize instance
const resourceArn = 'arn:aws:rds:us-east-1:1894848215:cluster:cluster-name';
const secretArn = 'arn:aws:secretsmanager:us-east-1:1894848215:secret:staging/rds-db-credentials/cluster-name-As$jOI';
const database = 'database_name'; // must be the same from Sequelize's 
const region = 'us-east-1';
const verbose = false; // true to log all queries and other data. Default if false

enableDataAPI(sequelize, { resourceArn, secretArn, database, region, verbose });
```

## Supported Sequelize Versions
Currently only tested on Sequelize@5.15.1