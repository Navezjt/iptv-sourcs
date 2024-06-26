import { hrtime } from "process"
import { updateChannelsJson } from "./components/channels"
import {
  cleanFiles,
  copyFiles,
  getContent,
  mergeSources,
  mergeTxts,
  writeEpgXML,
  writeDanmuXML,
  writeM3u,
  writeM3uToTxt,
  writeSources,
} from "./components/file";

import { updateChannelList, updateReadme } from "./components/readme";
import { sources } from "./api";
import { updateByRollback, updateEPGByRollback } from "./components/rollback"
import { epgs_sources } from "./api/epgs"
import { danmu_sources } from "./api/danmu"
import { writeTvBoxJson } from "./components/tvbox"
import { Collector } from "./utils"
import { runCustomTask } from "./task/custom"


cleanFiles();
copyFiles();

// 执行脚本
Promise.allSettled(
  sources.map(async (sr) => {
    console.log(`[TASK] Fetch ${sr.name}`)
    try {
      const [status, text, now] = await getContent(sr)
      if (/^[2]/.test(status.toString()) && !!text) {
        console.log(
          `Fetch m3u from ${sr.name} finished, cost ${(parseInt(hrtime.bigint().toString()) -
            parseInt(now.toString())) /
          10e6
          } ms`
        )
        const sourcesCollector = Collector(undefined, (v) =>
          !/^([a-z]+)\:\/\//.test(v)
        )
        let [m3u, count] = sr.filter(
          text as string,
          ["o_all", "all"].includes(sr.f_name) ? "skip" : "normal",
          sourcesCollector.collect
        )
        writeM3u(sr.f_name, m3u)
        writeM3uToTxt(sr.name, sr.f_name, m3u)
        writeSources(sr.name, sr.f_name, sourcesCollector.result())
        writeTvBoxJson(
          sr.f_name,
          [{ name: sr.name, f_name: sr.f_name }],
          sr.name
        )
        updateChannelList(sr.name, sr.f_name, m3u)
        return ["normal", count]
      } else {
        return undefined;
      }
    } catch (e) {
      const res = await updateByRollback(sr, sr.filter)
      if (!!res) {
        const [m3u, count] = res
        writeM3u(sr.f_name, m3u)
        writeM3uToTxt(sr.name, sr.f_name, m3u)
        writeTvBoxJson(
          sr.f_name,
          [{ name: sr.name, f_name: sr.f_name }],
          sr.name
        )
        updateChannelList(sr.name, sr.f_name, m3u)
        return ["rollback", count]
      } else {
        return ["rollback", void 0]
      }
    }
  })
)
  .then(async (result) => {
    const epgs = await Promise.allSettled(
      epgs_sources.map(async (epg_sr) => {
        console.log(`[TASK] Fetch EPG ${epg_sr.name}`)
        try {
          const [ok, text, now] = await getContent(epg_sr)

          if (ok && !!text) {
            console.log(
              `Fetch EPG from ${epg_sr.name} finished, cost ${(parseInt(hrtime.bigint().toString()) -
                parseInt(now.toString())) /
              10e6
              } ms`
            )
            writeEpgXML(epg_sr.f_name, text as string)
            return ["normal"]
          } else {
            // rollback
            const text = await updateEPGByRollback(epg_sr)
            if (!!text) {
              writeEpgXML(epg_sr.f_name, text as string)
              return ["rollback"]
            } else {
              // rollback failed
              console.log(
                `[WARNING] EPG ${epg_sr.name} get failed!`
              )
              return [void 0]
            }
          }
        } catch (e) {
          const text = await updateEPGByRollback(epg_sr)
          if (!!text) {
            writeEpgXML(epg_sr.f_name, text as string)
            return ["rollback"]
          } else {
            // rollback failed
            console.log(`[WARNING] EPG ${epg_sr.name} get failed!`)
            return [void 0]
          }
        }
      })
    )

    return {
      sources: result,
      epgs: epgs,
    }
  })

  .then((result) => {
    console.log(`[TASK] Write important files`)
    const sources_res = result.sources.map((r) => (<any>r).value)
    const epgs_res = result.epgs.map((r) => (<any>r).value)
    mergeTxts()
    mergeSources()
    writeTvBoxJson("tvbox", sources, "Channels")
    updateChannelsJson(sources, sources_res, epgs_sources)
    updateReadme(sources, sources_res, epgs_sources, epgs_res)
  })

  .then(async (result) => {
    const danmu = await Promise.allSettled(
      danmu_sources.map(async (danmu_sr) => {
        console.log(`[TASK] Fetch Danmu ${danmu_sr.name}`)
        try {
          const [status, text, now] = await getContent(danmu_sr)

          if (/^[2]/.test(status.toString()) && !!text) {
            console.log(
              `Fetch EPG from ${danmu_sr.name} finished, cost ${(parseInt(hrtime.bigint().toString()) -
                parseInt(now.toString())) /
              10e6
              } ms`
            )
            writeDanmuXML(danmu_sr.f_name, text as string)
            return ["normal"]
          } else {
            // rollback
            const text = await updateEPGByRollback(danmu_sr)
            if (!!text) {
              writeDanmuXML(danmu_sr.f_name, text as string)
              return ["rollback"]
            } else {
              // rollback failed
              console.log(
                `[WARNING] Danmu ${danmu_sr.name} get failed!`
              )
              return [void 0]
            }
          }
        } catch (e) {
          const text = await updateEPGByRollback(danmu_sr)
          if (!!text) {
            writeDanmuXML(danmu_sr.f_name, text as string)
            return ["rollback"]
          } else {
            // rollback failed
            console.log(`[WARNING] EPG ${danmu_sr.name} get failed!`)
            return [void 0]
          }
        }
      })
    )
    return {
      sources: result,
      danmu: danmu,
    }
  })

  .then(() => {
    console.log(`[TASK] Make custom sources`)
    runCustomTask()
  }).catch((err) => {
    console.error(err)
  })