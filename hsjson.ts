import fs from 'fs';
import path from 'path';
import axios, { AxiosRequestConfig } from 'axios';
import * as utils from './utils';
import Excel from 'exceljs';

const dataDir = path.resolve('data', 'hsjson');
const locales:ReadonlyArray<string> = ['zhCN','zhTW', 'enUS' ,'jaJP'];
const locale_keys:ReadonlyArray<string> = ['name', 'text', 'flavor'];
if (!fs.existsSync(dataDir)) utils.MkDirs(dataDir);
function GetLocalVersion(){
    return <string>fs.readdirSync(dataDir).filter(s=>s.match('\\d+')).sort().pop();
}
/** 请求latest对应的版本号 */
async function GetOnlineVersion():Promise<string>{
    console.log('获取版本号');
    //return '65614';
    let config:AxiosRequestConfig = {
        method: 'get',
        url: 'https://api.hearthstonejson.com/v1/latest/',
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'zh-CN,zh;q=0.9',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
        }
    };
    let response;
    try{
        response = await axios({timeout: 15 * 1000, ...config});
    }
    catch(e){
        if (e.code=='ECONNABORTED'){
            return await GetOnlineVersion(); //想不通，用while(1)循环就会导致请求一直没响应，用递归就没问题
        }
        throw e;
    }
    const path: string = (<any>response).request['path'] ?? '';
    console.log(path);
    return path.split('/')[2] ?? '';
}

/** 粗略判断下载的文件是否完整 */
async function IsArrayFileComplete(filePath:string) {
    let stat = fs.statSync(filePath);
    let buf = Buffer.alloc(16);
    let fd = fs.openSync(filePath, 'r+');
    fs.readSync(fd, buf, 0, 8, stat.size - 8);
    return buf.toString().endsWith('}]');
}
/** 下载文件的最新版本
 * @returns 仅当文件原本不存在，且成功下载时，返回true
 */
async function DownloadLatest(url:string, fileName:string, folder:string){
    let filePath = path.resolve(dataDir, folder, fileName);
    if (fs.existsSync(filePath)){
        console.log('文件已存在:\n\t' + filePath);
        return false;
    }
    console.log('开始下载:\n\t' + url);
    let success = await utils.Download(url, filePath);
    if (success) {
        if (IsArrayFileComplete(filePath)){
            console.log('下载成功:\n\t' + filePath);
            return true;
        }
        else{
            fs.renameSync(filePath, filePath + '.temp');
        }
    }
    console.warn('下载失败：资源不存在');
    return false;
}
/** 下载所有所需的json
 * @returns 至少有一个文件被更新时，返回true
 */
export async function DownloadAll(){
    let version = await GetOnlineVersion();
    if (isNaN(parseInt(version))){
        console.warn('wrong version:\n\t' + version);
        return false;
    }
    let result = await Promise.all([
        DownloadLatest('https://api.hearthstonejson.com/v1/enums.json', 'enums.json', version),
        ...locales.map(lang=>DownloadLatest('https://api.hearthstonejson.com/v1/latest/' + lang + '/cards.json', lang + '.json', version))
    ]);
    return result.some(b=>b);
}
function ReadAllData(specificVersion?:string):any[]{
    let version = specificVersion ?? GetLocalVersion();
    let localePaths = locales.map(lang => path.resolve(dataDir, version, lang + '.json'));
    for(let p of localePaths){
        if (!fs.existsSync(p)){
            console.warn('缺少文件:\n\t' + p);
            return [];
        }
    }
    let base = <{[k:string]:any}[]>JSON.parse(fs.readFileSync(localePaths[0]).toString());
    for(let i=1;i<locales.length;i++){
        let card_locale_map = utils.MapBy(JSON.parse(fs.readFileSync(localePaths[i]).toString()), 'dbfId');
        let lang = locales[i];
        for(let j=0;j<base.length;j++){
            let card = base[j];
            let locale_card = card_locale_map[card.dbfId];
            locale_keys.forEach(key=>{
                if (key in locale_card){
                    card[key + '_' + lang] = locale_card[key];
                }
            })
        }
    }
    base.forEach(card=>{
        card['_source'] = 'hsjson';
    });
    return base;
}
export function MakeJSON(){
    let version = GetLocalVersion();
    let data = ReadAllData(version);
    let length = data.length;
    let jsonPath = './json/hsjson';
    let cnt = 0;
    data.forEach(card=>{
        fs.writeFileSync(path.resolve(jsonPath, 'card_1_' + card.id + '.json'), JSON.stringify(card));
        ++cnt;
        if(cnt%1000===0) console.log(cnt + '/' + length);
    });
    fs.copyFileSync(path.resolve(jsonPath, 'enums.json'), path.resolve(dataDir, version, 'enums.json'))
}
/** 获取卡牌图片 */
export async function ImageList(){
    let data = ReadAllData();
    let list:[string, string][] = [];
    for(let card of data){
        if (card.type == 'ENCHANTMENT') continue;
        list.push(['img/hsjson/card ' + card.id + '.png', 'https://art.hearthstonejson.com/v1/render/latest/zhCN/512x/' + card.id + '.png']);
    }
    utils.List2File('imgList.txt', list);
    return list;
}
/** 获取卡牌原画 */
export async function ArtList(){
    let data = ReadAllData();
    let already = new Set(fs.readFileSync('D:/3D objects/游戏相关/炉石传说/wiki/条目列表.txt').toString().split('\r\n').map(s=>s.replace('文件:Art ', '').replace('.png', '').replace(/ /g, '_')));
    let list:[string, string][] = [];
    for(let card of data){
        if (card.type == 'ENCHANTMENT' || already.has(card.id)) continue;
        list.push(['img/art/art ' + card.id + '.png', 'https://art.hearthstonejson.com/v1/orig/' + card.id + '.png']);
    }
    utils.List2File('imgList.txt', list);
    return list;
}

export function Headers(){
    let all = ReadAllData();
    let result:utils.CardHeader[] = [];
    for(let card of all.filter(c=>c.type!=='ENCHANTMENT')){
        result.push({
            id: card.dbfId,
            name: card.name,
            bg: card.battlegroundsNormalDbfId || card.battlegroundsPremiumDbfId || card.battlegroundsHero
        });
    }
    return result;
}

export function DiffAll(){
    function CardDifferent(a:any, b:any):string[]|null{
        for (let k of ['name', 'text', 'flavor', 'cost', 'attack', 'health', 'type', 'set', 'rarity', 'cardClass', 'race']){
            if (utils.ValueDifferent(a[k], b[k])) {
                return [b.id, b.name, k, a[k], b[k]];
            };
        }
        return null;
    }
    let filename = 'zhCN';
    let dirs = fs.readdirSync(dataDir).filter(s=>s.match('\\d+')).sort();
    let curVersion = <string>dirs.pop();
    let prevVersion = <string>dirs.pop();
    let curDir = path.resolve(dataDir, curVersion);
    let curPath = path.resolve(curDir, filename + '.json');
    if (!fs.existsSync(curPath)){
        console.log('file not exists:\n\t' + curPath);
        return;
    }
    let cur:any[] = ReadAllData(curVersion).filter(c=>c.type!=='ENCHANTMENT');
    let prev:any[] = ReadAllData(prevVersion).filter(c=>c.type!=='ENCHANTMENT');;
    let map_cur = utils.MapBy(cur, 'id');
    let map_prev = utils.MapBy(prev, 'id');
    let set_cur = new Set(cur.map(c=>c.id));
    let set_prev = new Set(prev.map(c=>c.id));
    let list_new:string[] = [...set_cur].filter(x => !set_prev.has(x));
    let list_remove:string[] = [...set_prev].filter(x => !set_cur.has(x));;
    let list_change:any[] = [...set_cur].filter(x => set_prev.has(x))
        .map(id => CardDifferent(map_prev[id], map_cur[id]))
        .filter(info => info);
    console.log('新增：' + list_new.length);
    console.log('移除：' + list_remove.length);
    console.log('修改：' + list_change.length);

    let diffPath = path.resolve(curDir, 'diff.json');
    fs.writeFileSync(diffPath, JSON.stringify({
        new: list_new,
        remove: list_remove,
        change: list_change.map(info=>info[0]),
    }));
    console.log('file has been written to:\n\t' + diffPath)


    let wb = new Excel.Workbook();
    let ws = wb.addWorksheet('new');
    ws.addRow(['id', 'name']);
    list_new.forEach(id=> ws.addRow([id, map_cur[id].name]));

    ws = wb.addWorksheet('removed');
    ws.addRow(['id', 'name']);
    list_remove.forEach(id=> ws.addRow([id, map_prev[id].name]));

    ws = wb.addWorksheet('changed');
    ws.addRow(['id', 'name', 'key', 'from', 'to']);
    list_change.forEach(info=> ws.addRow(info));

    let xlsxPath = path.resolve(curDir, 'diff.xlsx');
    wb.xlsx.writeFile(xlsxPath);
    console.log('file has been written to:\n\t' + xlsxPath);
    

    let img_list:string[][] = [];
    [...list_new, ...list_change.map(info=>info[0])].forEach(id => {
        img_list.push([
            path.resolve('img/hsjson', 'Card_' + id + '.png'),
            'https://art.hearthstonejson.com/v1/render/latest/zhCN/512x/' + id + '.png'
        ]);
    });
    list_new.forEach(id => {
        img_list.push([
            path.resolve('img/art', 'Art_' + id + '.png'),
            'https://art.hearthstonejson.com/v1/orig/' + id + '.png'
        ]);
    });
    utils.List2File('imgList.txt', img_list);
    console.log('file has been written to:\n\t.\\imgList.txt');
}