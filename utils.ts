import fs from 'fs';
import axios from 'axios';
import progress from 'progress-stream';
import Excel from 'exceljs';
import path from 'path';

//#region DownloadBase
/** 记录上一次下载进度变化的时间点 */
let Time = Date.now();

/** 下载文件到指定路径。若路径不存在，会创建沿途文件夹。
 * @param args.timeout 最大等待时间/秒，默认为30
 */
export function Download(url: string, filePath: string, args:{
    headers?: any, 
    timeout?: number,
} = {}):Promise<boolean>{
    return new Promise((resolve, reject)=>{
        axios({
            method: 'get',
            url,
            responseType: 'stream',
            headers: args.headers,
            timeout: (args.timeout ?? 30) * 1000,
            /*proxy:{
                host: '112.28.229.132',
                port: 53984
            }*/
        }).then(response => {
            MkDirs(path.dirname(filePath));
            var p = progress({
                length: response.headers['content-length'],
                time: 500 /* ms */
            }).on('progress', progress=>{
                Time = Date.now();
                console.log(filePath + ': ' + progress.percentage.toFixed(2) + '%');
            });
            response.data.pipe(p).pipe(fs.createWriteStream(filePath + '.temp').on('close', ()=>{
                fs.renameSync(filePath + '.temp', filePath);
                resolve(true);
            }).on('error', reject));
        }, err => {
            if(err?.response?.status === 404){
                console.warn('下载失败(404):\n\t' + url);
                resolve(false);
            } 
            else reject(err);
        });
    })
};

export const Wait = (ms:number) => new Promise((resolve)=>{
    setTimeout(()=>{
        resolve(undefined);
    }, ms);
});

/** 批量下载 
 * @param args.clear 清除异常信息，默认为true
 * @param args.force 覆盖已存在的文件，默认为false
*/
export async function DownloadAll(li?:string[][], args:{
    force?:boolean,
    clear?:boolean,
    headers?:any
} = {}){
    let list = li ?? File2List('imgList.txt');
    if (!(args.force ?? false)){
        list = list.filter(([path, url])=>!fs.existsSync(path));
    }
    const filename_todo = './img_todo.txt';
    const filename_404 = './img_404.txt'
    const filename_err = './img_err.txt'
    List2File(filename_todo, list);
    if (args.clear ?? true){
        fs.writeFileSync(filename_404, '');
        fs.writeFileSync(filename_err, '');
    }

    let cur:string[][] = [];
    while(list.length>0){
        if (cur.length < 8 || Date.now() - Time > cur.length * 100 + 1000){ //保持n个任务；但若长时间无进展，则增加任务数
            Time = Date.now();
            let [path, url] = <string[]>list.pop();
            cur.push([path, url]);
            console.log(cur.map(pair=>pair[0]));
            Download(url, path, {timeout: 10, headers: args.headers}).then((success)=>{
                if (!success){
                    fs.appendFileSync(filename_404, path + ',' + url + '\n');
                }
            }, (err)=>{
                console.warn(err.message || err.code || err);
                list.unshift([path, url]);
                fs.appendFileSync(filename_err, path + ',' + url + '\n');
                try{ fs.unlinkSync(path);} catch(e){}
            }).then(()=>{
                cur.splice(cur.findIndex(pair=>pair[0] === path), 1);
                List2File(filename_todo, list.concat(cur));
                console.log('剩余：' + (list.length + cur.length), '当前任务数：' + cur.length);
            });
        }
        await Wait(100);
    }
    while(cur.length>0){
        await Wait(100);
    }
    console.log('下载完成');
}
/** 一次没下完的时候，继续上次的下载 */
export function DownloadAllRedo() {
    return DownloadAll(File2List('./img_todo.txt'), {clear: false});
}
/** 切分下载列表。需要借助外部下载工具(如迅雷)时使用。 */
export function SplitDownloadList(size:number = 1000){
    let list = File2List('imgList.txt');
    let cnt = 0;
    while(cnt*size<list.length){
        fs.writeFileSync('download-' + cnt + '.txt', list.slice(cnt*size, (cnt+1)*size).map(pair=>pair[1]).join('\n'));
        cnt += 1;
    }
}
/** 根据下载列表，将下载下来的文件重命名。在使用外部下载工具(如迅雷)后使用。 */
export function Rename(dir:string){
    let list = File2List('imgList.txt');
    let need:string[][] = [];
    for(let [name,url] of list){
        if(!url) {
            console.log(name);
            continue;
        }
        let path = dir + '/' + <string>url.split('/').pop();
        let newPath = dir + '/' + <string>name.split('/').pop();
        if (fs.existsSync(path)){
            fs.renameSync(path, newPath);
        }
        else{
            console.log(path);
            need.push([name,url]);
        }
    }
    List2File('need.txt', need);
}
//#endregion

//#region FileIO
/** 根据json数组，生成excel文件 */
export async function MakeXlsx(arr:any[], xlsxPath:string):Promise<void>;
export async function MakeXlsx(jsonPath:string, xlsxPath?:string):Promise<void>;
export async function MakeXlsx(input:any, xlsxPath:string = ''){
    let list:any[] = [];
    if (typeof input === 'string'){
        if (!input.toString().endsWith('.json') || !fs.existsSync(input)){
            console.warn(input + ' is not a JSON!');
            return;
        }
        try{
            list = JSON.parse(fs.readFileSync(input).toString());
        }
        catch(e){
            console.warn(input + ' is not a JSON Array!');
            return;
        }
        xlsxPath = xlsxPath || input.toString().replace(/\.json$/, '.xlsx');
    }
    else{
        list = input;
    }
    if (!Array.isArray(list)){
        console.warn('input is not a JSON Array!');
    }
    if (fs.existsSync(xlsxPath)){
        console.log(xlsxPath + ' already exists.');
        return;
    }
    let wb = new Excel.Workbook();
    let ws = wb.addWorksheet('1');
    let keys = GetKeys(list);
    console.log(keys.slice().sort());
    ws.addRow(keys);
    for(let card of list){
        let row = keys.map(key=>GetValue(card, key));
        ws.addRow(row);
    }
    await wb.xlsx.writeFile(xlsxPath);
    console.log('file has been written to\n\t' + xlsxPath);
}
export function File2List(path:string){
    return fs.readFileSync(path).toString().split('\n').filter(s=>!!s).map(line=>line.split(','))
}
export function List2File(path:string, list:string[][]){
    fs.writeFileSync(path, list.map(pair=>pair.join(',')).join('\n'));
}
//#endregion

//#region Key
export function GetKeys(list:any[]):string[]{
    function Valid(v:any){
        if (v === null || v === "") return false;
        if (v.match && v.match(/^http/)) return false;
        return true;
    }
    let set = new Set<string>();
    list.forEach(card=>{
        for(let key in card){
            let value = card[key];
            if (!Array.isArray(value) && typeof value === 'object'){
                for(let k in value){
                    let v = value[k];
                    if (Valid(v)) set.add(key + '.' + k);
                }
            }
            else{
                if (Valid(value)) set.add(key);
            }
        }
    });
    return Array.from(set.values());
}
export function GetValue(obj:any, key:string){
    let split = key.split('.');
    let val = obj;
    for(let k of split){
        if (val && k in val) val = val[k];
        else return null;
    }
    return val;
}
export function SetValue(obj:any, key:string, value:any=null){
    let split = key.split('.');
    let k;
    let v = obj;
    for(let i=0;i<split.length-1;i++){
        k = split[i];
        if(!(k in v)) v[k] = {};
        v = v[k];
    }
    if (value !== null) v[<string>split.pop()] = value;
}
//#endregion

/** 根据列表中各项目的某个字段，生成映射
 * @param key 主键的字段名，不可重复
 */
export function MapBy(list:any[], key:string){
    let result:{[k:string]:any} = {};
    list.forEach(v => result[v[key]] = v);
    return result;
}
export function FormatDate(date:Date, fmt:string) { 
    var o:any = { 
       "M+" : date.getMonth()+1,                 //月份 
       "d+" : date.getDate(),                    //日 
       "h+" : date.getHours(),                   //小时 
       "m+" : date.getMinutes(),                 //分 
       "s+" : date.getSeconds(),                 //秒 
       "q+" : Math.floor((date.getMonth()+3)/3), //季度 
       "S"  : date.getMilliseconds()             //毫秒 
   }; 
   if(/(y+)/.test(fmt)) { //年份
           fmt=fmt.replace(RegExp.$1, (date.getFullYear()+"").substr(4 - RegExp.$1.length)); 
   }
    for(var k in o) {
       if(new RegExp("("+ k +")").test(fmt)){
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length==1) ? (o[k]) : (("00"+ o[k]).substr((""+ o[k]).length)));
        }
    }
   return fmt; 
}
/** 判断文件是否已存在，并打印对应提示信息 */
export function BeforDownload(filepath:string){
    if (fs.existsSync(filepath)){
        console.log('file already exists:\n\t' + filepath);
        return false;
    }
    else{
        console.log('start downloading:\n\t' + path.basename(filepath.toString()));
        return true;
    }
}
/** 递归生成目录 */
export function MkDirs(dirname:string) {
    if (!fs.existsSync(dirname)) {
        MkDirs(path.dirname(dirname));
        fs.mkdirSync(dirname);
    }
}
/* 删除目录及下属文件*/
export function RmDir(dirPath:string) {
    let files = [];
    if( fs.existsSync(dirPath) ) {
        files = fs.readdirSync(dirPath);
        files.forEach(fileName => {
            let filePath = path.resolve(dirPath, fileName);
            if(fs.statSync(filePath).isDirectory()) {
                RmDir(filePath);
            } else {
                fs.unlinkSync(filePath);
            }
        });
        fs.rmdirSync(dirPath);
    }
}
/** 卡牌的基本信息 */
export interface CardHeader{
    id:number, 
    name:string, 
    bg:boolean
}

export function ValueDifferent(a: any, b:any){
    if (typeof a !== typeof b) return true;
    if (typeof a === 'object' && a!==null){
        let entries_a = Object.entries(a);
        if (entries_a.length !== Object.entries(b).length)
            return true;
        for(let [k,v] of entries_a){
            if (ValueDifferent(v, b[k])) {
                return true;
            };
        }
        return false;
    }
    else{
        if (typeof a === 'string'){
            return a.replace(/\n/g, '') !== b.replace(/\n/g, '');
        }
        return a !== b;
    }
}