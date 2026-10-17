import {expect,test} from 'vitest'
import { audioRange } from '../../public/offline-range.js'
test.each([['bytes=2-4',206,'234'],['bytes=-3',206,'789'],['bytes=7-',206,'789'],['bytes=0-99',206,'0123456789'],['bytes=90-',416,''],['bytes=5-2',416,''],['garbage',416,''],['bytes=-0',416,'']])('offline range %s',async(header,status,body)=>{const result=await audioRange(new Response('0123456789'),String(header));expect(result.status).toBe(status);expect(await result.text()).toBe(body)})
