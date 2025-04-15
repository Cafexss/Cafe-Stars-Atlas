/**
 * 交易所代币涨幅分析工具
 * 
 * 这个脚本用于分析交易所上架代币的涨幅情况，支持币安和OKX交易所
 * 主要功能包括：
 * 1. 获取交易所所有USDT交易对
 * 2. 批量获取代币的K线数据
 * 3. 计算近11天的价格涨幅
 * 4. 筛选出涨幅超过50%的代币
 * 5. 按涨幅降序排序并输出结果
 * 
 * 使用说明：
 * 1. 需要安装 axios, moment 和 cli-table3 依赖
 * 2. 运行脚本时输入交易所名称 (binance 或 okx)
 * 3. 默认只分析USDT交易对
 * 4. 支持批量处理和自动重试机制
 */

const axios = require('axios');
const moment = require('moment');
const Table = require('cli-table3');

// 交易所配置
const EXCHANGES = {
  binance: {
    name: '币安',
    baseUrl: 'https://api.binance.com/api/v3/klines',
    symbolListUrl: 'https://api.binance.com/api/v3/exchangeInfo',
    getSymbols: async (filterUSDT = true) => {
      try {
        const response = await axios.get(EXCHANGES.binance.symbolListUrl);
        const symbols = response.data.symbols;
        let tradingPairs = symbols.filter(symbol => symbol.status === 'TRADING');
        if (filterUSDT) {
          tradingPairs = tradingPairs.filter(symbol => symbol.symbol.endsWith('USDT'));
        }
        return tradingPairs.map(symbol => symbol.symbol);
      } catch (error) {
        console.error('Error fetching symbol list:', error.message);
        return [];
      }
    },
    getKlines: async (symbol, interval, startTime, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await axios.get(EXCHANGES.binance.baseUrl, {
            params: {
              symbol,
              interval,
              startTime,
              limit: 15,
            },
          });
          return response.data;
        } catch (error) {
          if (i === retries - 1) {
            console.error(`Failed to fetch data for ${symbol} after ${retries} attempts`);
            return null;
          }
          await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒后重试
        }
      }
    }
  },
  okx: {
    name: 'OKX',
    baseUrl: 'https://www.okx.com/api/v5/market/candles',
    symbolListUrl: 'https://www.okx.com/api/v5/public/instruments',
    getSymbols: async (filterUSDT = true) => {
      try {
        const response = await axios.get(EXCHANGES.okx.symbolListUrl, {
          params: {
            instType: 'SPOT'
          }
        });
        const instruments = response.data.data;
        let tradingPairs = instruments.filter(instrument => instrument.state === 'live');
        if (filterUSDT) {
          tradingPairs = tradingPairs.filter(instrument => instrument.quoteCcy === 'USDT');
        }
        return tradingPairs.map(instrument => instrument.instId);
      } catch (error) {
        console.error('Error fetching symbol list:', error.message);
        return [];
      }
    },
    getKlines: async (symbol, interval, startTime, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await axios.get(EXCHANGES.okx.baseUrl, {
            params: {
              instId: symbol,
              bar: interval,
              after: startTime,
              limit: 15,
            },
          });
          return response.data.data;
        } catch (error) {
          if (i === retries - 1) {
            console.error(`Failed to fetch data for ${symbol} after ${retries} attempts`);
            return null;
          }
          await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒后重试
        }
      }
    }
  }
};

// 分批处理数组
const chunkArray = (array, size) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, (i + 1) * size)
  );

// 计算涨幅
function calculatePercentageChange(openPrice, closePrice) {
  return ((closePrice - openPrice) / openPrice) * 100;
}

// 获取近11天涨幅>=50%的代币
async function findTopPerformingTokens(exchange) {
  const elevenDaysAgo = moment().subtract(11, 'days').valueOf();
  const symbols = await EXCHANGES[exchange].getSymbols(true);
  console.log(`\n📊 ${EXCHANGES[exchange].name}上架代币总数: ${symbols.length} 个\n`);

  const results = [];
  const batchSize = 50;
  const batches = chunkArray(symbols, batchSize);

  for (let i = 0; i < batches.length; i++) {
    console.log(
      `处理进度: ${Math.min((i + 1) * batchSize, symbols.length)}/${symbols.length} (${(
        ((i + 1) / batches.length * 100)
      ).toFixed(1)}%)`
    );
    const batch = batches[i];
    const promises = batch.map(symbol =>
      EXCHANGES[exchange].getKlines(symbol, exchange === 'binance' ? '1d' : '1D', elevenDaysAgo).then(klines => {
        if (klines && klines.length > 0) {
          const firstKline = klines[0];
          const lastKline = klines[klines.length - 1];
          const openPrice = parseFloat(firstKline[1]);
          const closePrice = parseFloat(lastKline[4]);
          const priceChange = calculatePercentageChange(openPrice, closePrice);
          if (priceChange >= 50) {
            return {
              symbol,
              priceChange,
              currentPrice: closePrice,
              openPrice
            };
          }
        }
        return null;
      })
    );
    const batchResults = (await Promise.all(promises)).filter(result => result);
    results.push(...batchResults);
  }

  // 按涨幅降序排序
  results.sort((a, b) => b.priceChange - a.priceChange);

  // 创建表格
  const table = new Table({
    head: ['币种交易对', '涨幅比例', '当前价格', '开盘价格'],
    colWidths: [20, 15, 15, 15],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });

  // 添加数据到表格
  results.forEach(result => {
    table.push([
      result.symbol,
      `${result.priceChange.toFixed(2)}%`,
      result.currentPrice.toFixed(8),
      result.openPrice.toFixed(8)
    ]);
  });

  // 输出结果
  if (results.length > 0) {
    console.log('\n🎯 符合条件的代币：');
    console.log(table.toString());
  } else {
    console.log('\n没有找到符合条件的代币');
  }
}

// 获取用户输入
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.question('请选择交易所 (binance/okx): ', async (exchange) => {
  if (EXCHANGES[exchange]) {
    await findTopPerformingTokens(exchange);
  } else {
    console.log('无效的交易所选择，请输入 binance 或 okx');
  }
  readline.close();
});
