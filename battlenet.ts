import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Excel from 'exceljs';
import * as utils from './utils';
import {access_token as token} from './token.json';


const headers = {Authorization: 'Bearer ' + token};
const languages:ReadonlyArray<string> = ['zh_TW', 'en_US', 'ja_JP'];
const locale_keys:ReadonlyArray<string> = ['name', 'text', 'flavorText'];
export enum Key{
    all = 'all',
    battlegrounds = 'battlegrounds'
}
const query_args = {
    [Key.all]: {collectible: '0,1'},
    [Key.battlegrounds]: {gameMode: 'battlegrounds'}
};
const Today = utils.FormatDate(new Date(), 'yyyyMMdd');
const DataDir = path.resolve('data', 'battlenet');
function NewDataDir(){
    let dir = path.resolve(DataDir, Today);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    return dir;
}
function GetLatestDataDirs(){
    let list = fs.readdirSync(DataDir).filter(s=>s.match('\\d+')).sort();
    if (list.length<=0){
        let dir = path.resolve(DataDir, Today);
        fs.mkdirSync(dir);
        list.push(Today);
    }
    return list.map(date => path.resolve(DataDir, date));
}
//#region Download
function DownloadData(url: string, filename: string){
    console.log('download:\n\t' + url);
    return utils.Download('https://tw.api.blizzard.com/hearthstone/' + url, filename, {headers});
}
async function GetData(url: string){
    console.log('get:\n\t' + url);
    let response = await axios.get('https://tw.api.blizzard.com/hearthstone/' + url, {headers});
    return response.data;
}
function MakeUrlParams(args: { [x: string]: string; }){
    let result = '';
    for(let k in args){
        result += result==='' ? '?' : '&';
        result += k + '=' + args[k];
    }
    return result;
}
function Fix(obj:any){
    while(Array.isArray(obj[0])){
        obj = obj[0];
    }
    return obj;
}
export async function GetCards(args: any, cachePath?: string){
    args = {...args};
    if (cachePath && !fs.existsSync(cachePath)) fs.mkdirSync(cachePath);
    let filePath = path.resolve(cachePath ?? '', 1 + '.json');
    let first = cachePath && fs.existsSync(filePath) 
        ? JSON.parse(fs.readFileSync(filePath).toString()) 
        : await GetData('cards' + MakeUrlParams(args));
    if (cachePath) fs.writeFileSync(filePath, JSON.stringify(first));
    let lists: any[][] = [Fix(first['cards'])];
    let cnt = first['pageCount'];
    console.log(first['cardCount']);
    let blockSize = 3; // 每次下3个
    for (let blockStart = first['page'];blockStart<=cnt;blockStart+=blockSize){
        let block = [];
        for(let page=blockStart;page<blockStart+4;page++){
            block.push();
        }
        let tasks = [...Array(blockSize).keys()].map(i=>i+blockStart).filter(page=>page<=cnt).map(page=>(async function(){
            console.log(page);
            let filePath = path.resolve(cachePath ?? '', page + '.json');
            console.log(filePath);
            let pageData;
            if (cachePath && fs.existsSync(filePath)){
                pageData = JSON.parse(fs.readFileSync(filePath).toString());
            }
            else{
                let params = MakeUrlParams({...args, page})
                console.log(params);
                pageData = await GetData('cards' + params);
            }
            lists[page - 1] = Fix(pageData['cards']);
            console.log(page + '/' + cnt);
            if (cachePath) fs.writeFileSync(filePath, JSON.stringify(pageData));
        })());
        while(1){
            try{
                await Promise.all(tasks);
            }
            catch(err){
                console.log(err);
                await utils.Wait(10000);
                continue;
            }
            break;
        }
    }
    if (cachePath) utils.RmDir(cachePath);
    let list:any[] = [];
    lists.forEach(l=>{
        list = list.concat(l);
    });
    console.log(list.length);
    return list;
}
export async function GetOneCard(id:number|string, battlegrounds = false, locale='zh_CN'){
    try {
        return await GetData('cards/' + id + '?locale=' + locale + (battlegrounds ? '&gameMode=battlegrounds' : ''));
    } catch (err) {
        if (err?.response?.status === 404)
            return null;
        return err;
    }
}
/** 下载metadata。若metadata.classes有变化，则再下载heros */
export async function DownloadMetadata(){
    let prevClasses = <any[]>ReadLatest('metadata').classes;

    let dir = NewDataDir();
    let matadata_path = path.resolve(dir, 'metadata.json');
    if (utils.BeforDownload(matadata_path)){
        await DownloadData('metadata?locale=zh_CN', matadata_path);
    }

    let hero_path = path.resolve(dir, 'heros.json');
    if (utils.BeforDownload(hero_path)){
        let metadata = JSON.parse(fs.readFileSync(matadata_path).toString());
        let classes = <any[]>metadata.classes;
        if (!utils.ValueDifferent(classes, prevClasses)) {
            console.log('heros no change');
            return;
        }
        let ids = classes.map(item=>item.cardId).filter(Number);
        let cards:any[] = [];
        for(let id of ids){
            let card = await GetOneCard(id);
            for(let lang of languages){
                let card_lang = await GetOneCard(id, false, lang);
                locale_keys.forEach(key=>{
                    card[key+'_'+lang.replace('_','')] = card_lang[key];
                });
            }
            cards.push(card);
        }
        fs.writeFileSync(path.resolve(dir, 'heros.json'), JSON.stringify(cards));
    }
}
export async function DownloadAllLanguage(key: Key){
    let args:any = {...query_args[key]};
    let filename = key;
    let dir = NewDataDir();
    let filePath = path.resolve(dir, filename+'.json');
    let tasks = ['zh_CN', ...languages].map(lang => (async function(){
        let filepath = lang==='zh_CN' ? filePath : path.resolve(dir, filename+'_'+lang+'.json');
        if (utils.BeforDownload(filepath)){
            args.locale = lang;
            let list = await GetCards(args, path.resolve(dir, filename+'_'+lang));
            fs.writeFileSync(filepath, JSON.stringify(list));
        }
    })());
    await Promise.all(tasks);
    utils.MakeXlsx(filePath);
}
/** 请求列表数量，与最新的本地文件对比，判断是否变化 */
export async function Changed(key: Key){
    let args:any = {...query_args[key]};
    let filename = key;
    let oldDir = <string>GetLatestDataDirs().pop();
    if (oldDir.endsWith(Today)){
        console.log('already checked today.');
        return true;
    }
    args = {...args};
    args.locale = 'zh_CN';
    let oldData = <any[]>ReadLatest(filename);
    let oldCnt = oldData.length;
    let newData = await GetData('cards' + MakeUrlParams(args));
    let newCnt = newData.cardCount;
    console.log(oldCnt + ' => ' + newCnt);
    return newCnt !== oldCnt;
}
//#endregion

//#region Image
async function BattlegroundsGoldenImage(id:number):Promise<[string, string]>{
    let goldenCard = await GetOneCard(id, true);
    if (goldenCard === null){ // 有金卡id但没有金卡数据
        return [id.toString(), ''];
    }
    let url = goldenCard['battlegrounds']['imageGold'];
    if (!url){
        console.log(id);
        url = goldenCard['battlegrounds']['image']; //某些金卡(61934)没有金图，只有普通图
    }
    return [id.toString(), url];
}
async function MakeImgListForDiff(){
    let [all_list, bg_list] = ['all', 'battlegrounds'].map(name=>ReadAllLanguage(name));
    let [all,bg] = [all_list, bg_list].map(list=>utils.MapBy(list, 'id'));
    let dir = <string>GetLatestDataDirs().pop();
    let [all_diff, bg_diff]:any[] = ['all', 'battlegrounds'].map(name=>{
        let filePath = path.resolve(dir, name + '_diff.json');
        if (!fs.existsSync(filePath)) return {new:[],diff:[],change:[]};
        return JSON.parse(fs.readFileSync(filePath).toString());
    });
    let img_list = [...all_diff.new, ...all_diff.change]
        .map(id => all[id])
        .filter(card => card.cardSetId !== 1453 || card.cardTypeId !== 4) //排除战棋随从
        .map(card =>{
            return ['img/battlenet/card ' + card.id + (card.cardSetId === 1453 ? ' bg' : '') + '.png', card.image];
        });
    for (let id of [...bg_diff.new, ...bg_diff.change]){
        let card = bg[id];
        if (card.cardTypeId !== 4) continue;
        if (!card.battlegrounds) console.log(card);
        img_list.push(['img/battlenet/card ' + id + ' bg.png', card.battlegrounds.image]);
        let [goldId, goldUrl] = await BattlegroundsGoldenImage(card['battlegrounds']['upgradeId']);
        if (!goldUrl){
            console.warn(card.id + '对应的金卡' + card['battlegrounds']['upgradeId'] + '不存在');
        }
        else{
            img_list.push(['img/battlenet/card ' + goldId + ' bg.png', goldUrl]);
        }
    }
    utils.List2File('imgList.txt', img_list);
    console.log('file has been written to:\n\t.\\imgList.txt');
}
//#endregion

//#region Read
function ReadSingle(filePath: string){
    console.log('read:\n\t' + filePath);
    let result = JSON.parse(fs.readFileSync(filePath).toString());
    return result;
}
function ReadLatest(name: string, offset: number = 0){
    if (!name.endsWith('.json')) name = name + '.json';
    let dirs = GetLatestDataDirs();
    while (dirs.length>0){
        let dir = <string>dirs.pop();
        let filePath = path.resolve(dir, name);
        if (fs.existsSync(filePath) && offset-- === 0){
            return ReadSingle(filePath);
        }
    }
    console.warn('not found: ' + name);
}
function ReadAllLanguage(name: string){
    name = name.replace(/.json$/, '');
    let base:any[] = ReadLatest(name);
    languages.forEach(lang => {
        let card_locale_map = utils.MapBy(ReadLatest(name+'_'+lang), 'id');
        base.forEach(card => {
            if (!card.id) throw(JSON.stringify(card));
            let id = card.id;
            let card_locale = card_locale_map[id];
            locale_keys.forEach(key=>{
                if (!card_locale) throw(lang+':'+id);
                card[key+'_'+lang.replace('_', '')] = card_locale[key];
            });
        });
    });
    return base;
}
function ReadHeros(){
    return ReadLatest('heros');
}
//#endregion
async function GetRelated(list: any[]){
    let map = utils.MapBy(list, 'id');
    let allRelatedIds = new Set<number>();
    list.forEach(card=>{
        if (card.parentId) allRelatedIds.add(card.parentId);
        if (card.childIds) (<number[]>card.childIds).forEach(id=>allRelatedIds.add(id));
    });
    let needIds = new Set<number>();
    for(let id of allRelatedIds.values()){
        if (!map[id]) needIds.add(id);
    }
    return Array.from(needIds.values());
}
export async function DiffAll(date?:string){
    function CardDifferent(a:any, b:any):string[]|null{
        for (let k of ['name', 'text', 'flavorText', 'manaCost', 'attack', 'health', 'cardTypeId', 'cardSetId', 'rarityId', 'classId', 'minionTypeId', 'spellSchoolId']){
            if (utils.ValueDifferent(a[k], b[k])) {
                return [b.id, b.name, k, a[k], b[k]];
            };
        }
        return null;
    }
    let curDir = path.resolve(DataDir, date ?? Today);
    fs.writeFileSync('./删除.txt', '');
    for (let filename in Key){
        let curPath = path.resolve(curDir, filename + '.json');
        if (!fs.existsSync(curPath)){
            console.log('file not exists:\n\t' + curPath);
            continue;
        }
        let cur:any[] = ReadSingle(curPath);
        let prev:any[] = ReadLatest(filename, 1);
        let map_cur = utils.MapBy(cur, 'id');
        let map_prev = utils.MapBy(prev, 'id');
        let set_cur = new Set(cur.map(c=>c.id));
        let set_prev = new Set(prev.map(c=>c.id));
        let list_new:number[] = [...set_cur].filter(x => !set_prev.has(x));
        let list_remove:number[] = [...set_prev].filter(x => !set_cur.has(x));;
        let list_change:any[] = [...set_cur].filter(x => set_prev.has(x))
            .map(id => CardDifferent(map_prev[id], map_cur[id]))
            .filter(info => info);
        console.log('新增：' + list_new.length);
        console.log('移除：' + list_remove.length);
        console.log('修改：' + list_change.length);

        let diffPath = path.resolve(curDir, filename + '_diff.json');
        if (!fs.existsSync(diffPath)){
            fs.writeFileSync(diffPath, JSON.stringify({
                new: list_new,
                remove: list_remove,
                change: list_change.map(info=>info[0]),
            }));
            console.log('file has been written to:\n\t' + diffPath)
        }
        fs.appendFileSync('./删除.txt', list_remove.map(id=>'Data:Card/' + id + '.json\n').join(''));

        let xlsxPath = path.resolve(curDir, filename + '_diff.xlsx');
        if (!fs.existsSync(xlsxPath)){
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
    
            wb.xlsx.writeFile(xlsxPath);
            console.log('file has been written to:\n\t' + xlsxPath)
        }
    }
    await MakeImgListForDiff();
}
export function MakeJSON(){
    let dir = './json/battlenet';

    //复制metadata
    let metadataPath = path.resolve(<string>GetLatestDataDirs().pop(), 'metadata.json');
    if (fs.existsSync(metadataPath)){
        fs.copyFileSync(metadataPath, path.resolve(dir, 'metadata.json'));
    }

    let bg:any[] = ReadAllLanguage('battlegrounds');
    let all:any[] = ReadAllLanguage('all').concat(ReadHeros());
    let bg_map = utils.MapBy(bg, 'id');
    let keys = utils.GetKeys(all);
    let keys_bg = utils.GetKeys(bg);

    let bg_upgrade:{[a:number]:number} = {}
    for(let card of bg){
        let up_id = card.battlegrounds?.upgradeId;
        if(up_id){
            bg_upgrade[up_id] = card.id;
        }
    }
    console.log('start writing json...');
    for(let card of all){
        let id = card.id;
        if(!id){
            console.log(card);
            continue;
        }
        let card_bg = bg_map[id]; //战棋卡

        let json:{[k:string]:any} = {};
        for(let k of keys){
            utils.SetValue(json, k, utils.GetValue(card, k));
        }
        if(card_bg){
            for(let k of keys_bg){
                utils.SetValue(json, k, utils.GetValue(card_bg, k));
            }
        }
        if (bg_upgrade[id]){ //战棋三连
            let origin = bg_map[bg_upgrade[id]];
            for(let k of keys_bg){
                if(!k.startsWith('battlegrounds')) continue;
                if(k.endsWith('upgradeId')){
                    utils.SetValue(json, k.replace('upgradeId', 'originId'), bg_upgrade[id]);
                }
                else{
                    utils.SetValue(json, k, utils.GetValue(origin, k));
                }
            }
        }
        json['_source'] = 'battlenet';
        let filePath = path.resolve(dir, 'card_1_' + id + '.json');
        let json_s = JSON.stringify(json);
        if (fs.existsSync(filePath) && fs.readFileSync(filePath).toString() === json_s) continue;
        fs.writeFileSync(filePath, JSON.stringify(json));
    }
    console.log('files has been written to:\n\t' + dir)
}
export function Headers(){
    let all:any[] = ReadAllLanguage('all').concat(ReadHeros());
    let bg:any[] = ReadAllLanguage('battlegrounds');
    let bg_map = utils.MapBy(bg, 'id');
    let bg_upgrade:{[a:number]:number} = {};
    for(let card of bg){
        let up_id = card.battlegrounds?.upgradeId;
        if(up_id){
            bg_upgrade[up_id] = card.id;
        }
    }
    let result:utils.CardHeader[] = [];
    for(let card of all){
        let id = card.id;
        let name = card.name;
        let card_bg = bg_map[id]; //战棋卡
        
        if (card_bg || (card.cardSetId === 1453 && (card.cardTypeId===10 || bg_upgrade[id]))){ //是战棋卡(不包括被移除的英雄和随从)
            result.push({
                id,
                name,
                bg: true,
            });
        }
        if (card.cardSetId !== 1453) { //不是战棋专属卡
            result.push({
                id,
                name,
                bg: false,
            });
        }
    }
    return result;
}