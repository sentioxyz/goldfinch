import { TestProcessorServer } from '@sentio/sdk/testing'
// import { mockCreditLineCreatedLog } from "./types/goldfinchfactory/test-utils.js";

import {jest} from '@jest/globals';

jest.setTimeout(30000)

describe('Test Processor', () => {
  jest.setTimeout(3000000);

  // http://test-proxy-eth.test:8645
  const service = new TestProcessorServer(async ()=> await import('./processor.js'), {
    1: "http://localhost:8645",
    // 1: "https://eth-mainnet.g.alchemy.com/v2/z1Q-YhcYg60C5sOQPUzsMFqiDJSvqbsK",
  })
  beforeAll(async () => {
    await service.start()
  })

  test('has config', async () => {
    const config = await service.getConfig({})
    expect(config.contractConfigs.length > 0)
  })

  test('Check block dispatch', async () => {
    // const evt = mockCreditLineCreatedLog(
    //     "0xd20508E1E971b80EE172c73517905bfFfcBD87f9", {
    //       creditLine: "0xxxxxxx"
    //     }
    // )
    //

    const blockData = {
      hash: '0x877c13959e71d4a7d234043ed7c853c3400a199b3dcf2b75376f5479a086aa3b',
      number: 0xf5980a,
      timestamp: 0x638996e7,
      extraData: '0x68747470733a2f2f6574682d6275696c6465722e636f6d',
    }


    try {
      const res = (await service.testBlock(blockData)).result
    } catch (e) {
      console.log(e)
    }

  })


  const logData = "{\"blockHash\":\"0xee67ddf83fbda8722dea0615036cb6655028d2a21bcd2c43b50a02ce44b1317c\",\"data\":\"0x00000000000000000000000000000000000000000000000000000179c3398f80\",\"blockNumber\":\"0xc86ec1\",\"logIndex\":\"0xc2\",\"transactionHash\":\"0x72b770d41920a6ba3b153a17d0b0af7a25675b874363e77e9c0043730df06834\",\"topics\":[\"0x86da25fff7a4075a94de2ffed109ca6748c3af22736eaf7efc75e3988f899d6e\",\"0x000000000000000000000000efeb69edf6b6999b0e3f2fa856a2acf3bdea4ab5\"],\"removed\":false,\"transactionIndex\":\"0x75\",\"address\":\"0x8481a6EbAf5c7DABc3F7e09e44A89531fd31F822\"}"


  test('check log dispatch', async () => {

    const r = await service.testLog(JSON.parse(logData))
    console.log(r)
  })
})
