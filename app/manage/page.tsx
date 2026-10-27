'use client'

import dynamic from 'next/dynamic'

const ManageContent=dynamic(()=>import('@/components/manage/ManageContent').then(module=>module.ManageContent),{ssr:false,loading:()=> <div className="min-h-screen grid place-items-center"><div className="loader-line w-24"/></div>})
export default function ManagePage(){return <ManageContent/>}
