import {
    STAKED_FIDU,
    POOL_TOKEN
} from "./constant.js";

export const SECONDS_PER_DAY = 60n * 60n * 24n
export const DAYS_PER_YEAR = 365

export function isPaymentLate(timestemp: bigint, nextDueTime: bigint, balance: bigint) {
    return balance > 0n && timestemp > nextDueTime
}

export function isPaymentLateForGracePeriod(timestemp: bigint, nextDueTime: bigint, gracePeriodLateness: bigint, balance: bigint) {
    return balance > 0 && timestemp > (nextDueTime  + gracePeriodLateness * SECONDS_PER_DAY)
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