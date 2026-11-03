import {PENDING_KEY} from '../launchHistory'
import {readTradePending} from '../venues/tradeHistory'
import {readPendingWalletOperation} from '../walletOperations/history'
import {assertNoPendingGroupOperation} from '../walletGroups/history'
import {assertNoPendingBundleReceipt} from '../bundler/pending'
import {assertNoUnresolvedRelay} from '../relay/pendingGuard'
import {assertNoPendingCreatorOperation,creatorStorage} from '../creatorOperations/history'
import {publicSupplyLockPending,readPendingSupplyLock,readSupplyLockHistory,type PendingSupplyLock} from './history'
import type {SupplyLockStorage} from './model'

export function assertSupplyLockAvailable(storage?:SupplyLockStorage,allowed?:PendingSupplyLock):void{
 const disk=creatorStorage(storage),current=readPendingSupplyLock(disk)
 if(allowed?JSON.stringify(current)!==JSON.stringify(publicSupplyLockPending(allowed)):!!current)throw new Error('A supply lock is pending or its original record changed. Check its signature first.')
 readSupplyLockHistory(disk);assertNoPendingCreatorOperation(disk)
 if(disk.getItem(PENDING_KEY)!==null||readTradePending(disk)||readPendingWalletOperation(disk))throw new Error('A launch, trade or wallet operation is pending. Resolve its original signature first.')
 assertNoPendingGroupOperation(disk);assertNoPendingBundleReceipt(disk);assertNoUnresolvedRelay(disk)
}
