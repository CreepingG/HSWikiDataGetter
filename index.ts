import fs from 'fs';
import Excel from 'exceljs';
import * as utils from './utils';
import * as Battlenet from './battlenet';
import {Key} from './battlenet';
import * as HsJson from './hsjson';

async function MakePage(){
    const exclusion = ['德鲁伊','猎人','法师','圣骑士','牧师','潜行者','萨满祭司','术士','战士', 
        '法术伤害','沉默', '风怒', '冲锋', '变形', '激怒', '战吼', '奥丹姆奇兵'];
    let list = [...Battlenet.Headers(), ...HsJson.Headers()];
    let pageMap:{[k:string]:Set<string>} = {};
    let wb = new Excel.Workbook();
    let ws = wb.addWorksheet('1');
    list.forEach(h=>{
        let name = h.name;
        let link = h.id + (h.bg ? ' bg':'');
        if (exclusion.includes(name) || name.match(/[[?]/)) return;
        if (!(name in pageMap)) pageMap[name] = new Set();
        pageMap[name].add(link);
    });
    for(let [name, set] of Object.entries(pageMap)){
        let text = '';
        let arr = Array.from(set.values()).sort((a,b)=>{
            let [n_a, n_b] = [a,b].map(s => parseInt((s.match(/\d+/) || [])[0] || '0'));
            if (n_a === n_b){
                return a.endsWith('bg') ? 1 : -1;
            }
            return n_a - n_b;
        });
        if (arr.length===1){
            text = '#REDIRECT[[Card/' + arr[0] + ']]';
        }
        else{
            text = '{{同名卡牌|' + arr.join('|') + '}}'
        }
        ws.addRow([name, text]);
    }
    await wb.xlsx.writeFile('重定向.xlsx');
    console.log('file has been written to\n\t重定向.xlsx');

    wb = new Excel.Workbook();
    ws = wb.addWorksheet('1');
    ws.addRow(['卡牌页','id','name','酒馆战棋']);
    let already = new Set(fs.readFileSync('D:/3D objects/游戏相关/炉石传说/wiki/条目列表.txt').toString().split('\r\n'));
    let map:{[link:string]:any} = {};
    list.forEach(h=>{
        let link = 'Card/' + h.id + (h.bg ? ' bg':'');
        if(!(link in map) && !already.has(link)) map[link] = h;
    });
    for(let [link, header] of Object.entries(map)){
        if (header.name!=='[TEMP]')
            ws.addRow([link, header.id, header.name, header.bg ? '1':'']);
    }
    await wb.xlsx.writeFile('模板.xlsx');
    console.log('file has been written to\n\t模板.xlsx');
}

(async function main(){
    //console.log(await Battlenet.GetOneCard('72250'));
    /*let changed = await Promise.all([Battlenet.Changed(Key.all), Battlenet.Changed(Key.battlegrounds)]);
    //changed[0] = true;
    if (changed[0] || changed[1]){
        await Battlenet.DownloadMetadata();
        if (changed[0]) await Battlenet.DownloadAllLanguage(Key.all);
        if (changed[1]) await Battlenet.DownloadAllLanguage(Key.battlegrounds);
        await Battlenet.DiffAll();
        Battlenet.MakeJSON();
    }*/
    
    /*if (await HsJson.DownloadAll()){
        HsJson.DiffAll();
        HsJson.MakeJSON();
    }*/
    
    MakePage();

    //utils.SplitDownloadList(250);
    //await utils.DownloadAll();
    //await utils.DownloadAllRedo();
    //await utils.DownloadAll(utils.File2List('img_err.txt'));
})();