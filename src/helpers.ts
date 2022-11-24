import type {BigNumber} from 'ethers'
import { 
    STAKED_FIDU,
    POOL_TOKEN
} from "./constant";

export const SECONDS_PER_DAY = 60 * 60 * 24
export const DAYS_PER_YEAR = 365

export function isPaymentLate(timestemp: BigNumber, nextDueTime: BigNumber, balance: BigNumber) {
    return balance.gt(0) && timestemp.gt(nextDueTime)

}

export function isPaymentLateForGracePeriod(timestemp: BigNumber, nextDueTime: BigNumber, gracePeriodLateness: BigNumber, balance: BigNumber) {
    return balance.gt(0) && timestemp.gt(nextDueTime.add(gracePeriodLateness.mul(SECONDS_PER_DAY)))
}

export function getAssetType(assetAddress: string) {
    if (assetAddress.toLocaleLowerCase() == STAKED_FIDU.toLowerCase()) {
        return "staked_fidu"
    } else if (assetAddress.toLocaleLowerCase() == POOL_TOKEN.toLowerCase()) {
        return "pool_token"
    } else {
        return "UNKNOWN"
    }
}