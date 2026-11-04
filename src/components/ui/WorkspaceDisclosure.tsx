'use client'
import {forwardRef,type ReactNode} from 'react'
import {ChevronDown} from 'lucide-react'
import styles from './WorkspaceDisclosure.module.css'

/** Native disclosure keeps signing/recovery children mounted when collapsed. */
export const WorkspaceDisclosure=forwardRef<HTMLDetailsElement,{title:string;description:string;meta?:ReactNode;children:ReactNode;defaultOpen?:boolean}>(({title,description,meta,children,defaultOpen=false},ref)=><details ref={ref} className={styles.disclosure} open={defaultOpen||undefined}>
 <summary className={styles.summary}><span className={styles.labels}><strong>{title}</strong><span>{description}</span></span><span className={styles.meta}>{meta}<ChevronDown size={17} className={styles.chevron} aria-hidden="true"/></span></summary>
 <div className={styles.content}>{children}</div>
</details>)
WorkspaceDisclosure.displayName='WorkspaceDisclosure'
