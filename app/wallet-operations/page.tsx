import {Suspense} from 'react'
import {WalletWorkspace,WalletWorkspaceLoading} from '@/components/wallet/WalletWorkspace'
export default function WalletOperationsPage(){return <Suspense fallback={<WalletWorkspaceLoading/>}><WalletWorkspace/></Suspense>}
