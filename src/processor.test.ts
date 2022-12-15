import { TestProcessorServer } from '@sentio/sdk/lib/testing'
import { mockCreditLineCreatedLog } from "./types/goldfinchfactory/test-utils";

jest.setTimeout(30000)

describe('Test Processor', () => {
  jest.setTimeout(3000000);

  const service = new TestProcessorServer(()=> require('./processor'), {
    1: "https://eth-mainnet.g.alchemy.com/v2/SAow9F_73wmx_Uj5yEcI_au8y9GXYYd5",
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
})
