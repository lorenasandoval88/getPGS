//import pako from 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.esm.mjs'
const pako = require('pako');
//---------------------------------------------------------------
// search for traits by different parameters
function searchTraits(traitFiles){
    let obj = {}
    obj["traitIds"] = traitFiles.map( x => x.id)
    obj["traitLabels"] = traitFiles.map( x => x.label)
    obj["traitCategories"] = Array.from(new Set(traitFiles.flatMap(x => x["trait_categories"]).sort().filter(e => e.length).map(JSON.stringify)), JSON.parse)
    return obj
}

//---------------------------------------------------------------
// fetch all score and trait files and cache to local storage
async function fetchAll2(url, maxPolls = null) {
    const allResults = []
    const counts = (await (await (fetch(url))).json())
    if (maxPolls == null) maxPolls = Infinity
    // loop throught the pgs catalog API to get all files using "offset"
    for (let i = 0; i < Math.ceil(counts.count / 100); i++) { //4; i++) { //maxPolls; i++) {
        let offset = i * 100
        let queryUrl = `${url}?limit=100&offset=${offset}`
        // get trait files and scoring files from indexDB if the exist
        let cachedData = (await (await fetch(queryUrl)).json()).results
        allResults.push(cachedData)

        // cach url and data 
    }
    return allResults
}
//  //---------------------------------------------------------------
// structure scoring files
async function parsePGS(id, txt) {
    let obj = {
        id: id
    }
    obj.txt = txt
    let rows = obj.txt.split(/[\r\n]/g)
    let metaL = rows.filter(r => (r[0] == '#')).length
    obj.meta = {
        txt: rows.slice(0, metaL)
    }
    obj.cols = rows[metaL].split(/\t/g)
    obj.dt = rows.slice(metaL + 1).map(r => r.split(/\t/g))
    if (obj.dt.slice(-1).length == 1) {
        obj.dt.pop(-1)
    }
    // parse numerical types
    const indInt = [obj.cols.indexOf('chr_position'), obj.cols.indexOf('hm_pos')]
    const indFloat = [obj.cols.indexOf('effect_weight'), obj.cols.indexOf('allelefrequency_effect')]
    const indBol = [obj.cols.indexOf('hm_match_chr'), obj.cols.indexOf('hm_match_pos')]

    // /* this is the efficient way to do it, but for large files it has memory issues
    obj.dt = obj.dt.map(r => {
        // for each data row
        indFloat.forEach(ind => {
            r[ind] = parseFloat(r[ind])
        })
        indInt.forEach(ind => {
            r[ind] = parseInt(r[ind])
        })
        indBol.forEach(ind => {
            r[ind] = (r[11] == 'True') ? true : false
        })
        return r
    })
    // bigquery format
    let dt2 = obj.dt.map( (x, idx) => Object.fromEntries(obj.cols.map((_, i) => [obj.cols[i], obj.dt[idx][i]])) )
   obj.dt2 =  dt2
    // parse metadata
    obj.meta.txt.filter(r => (r[1] != '#')).forEach(aa => {
        aa = aa.slice(1).split('=')
        obj.meta[aa[0]] = aa[1]
    })
    return obj
}

async function loadScore(entry = 'PGS000004', build = 37, range) {
    console.log("loadScore")
    let txt = ""
    entry = "PGS000000".slice(0, -entry.length) + entry
    // https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/PGS000004/ScoringFiles/Harmonized/PGS000004_hmPOS_GRCh37.txt.gz
    const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${entry}/ScoringFiles/${entry}.txt.gz` //
   // console.log("loadng unharmonized pgs score from url",url)

    if (range) {
        if (typeof (range) == 'number') {
            range = [0, range]
        }
        txt = pako.inflate(await (await fetch(url, {
            headers: {
                'content-type': 'multipart/byteranges',
                'range': `bytes=${range.join('-')}`,
            }
        })).arrayBuffer(), {
            to: 'string'
        })
    } else {
        txt = pako.inflate(await (await fetch(url)).arrayBuffer(), {
            to: 'string'
        })
    }
    // Check if PGS catalog FTP site is down-----------------------
    let response
    response = await fetch(url) // testing url 'https://httpbin.org/status/429'
    if (response?.ok) {
        ////console.log('Use the response here!');
    } else {
        txt = `:( Error loading PGS file. HTTP Response Code: ${response?.status}`
        document.getElementById('pgsTextArea').value = txt
    }
    console.log("text")
    return txt
}
async function loadScoreHm(entry = 'PGS000004', build = 37, range) {
    let txt = ""
    entry = "PGS000000".slice(0, -entry.length) + entry
    // https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/PGS000004/ScoringFiles/Harmonized/PGS000004_hmPOS_GRCh37.txt.gz
    const url = `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${entry}/ScoringFiles/Harmonized/${entry}_hmPOS_GRCh${build}.txt.gz` //
    //console.log("loadng harmonized pgs score from url",url)
    if (range) {
        if (typeof (range) == 'number') {
            range = [0, range]
        }
        txt = pako.inflate(await (await fetch(url, {
            headers: {
                'content-type': 'multipart/byteranges',
                'range': `bytes=${range.join('-')}`,
            }
        })).arrayBuffer(), {
            to: 'string'
        })
    } else {
        txt = pako.inflate(await (await fetch(url)).arrayBuffer(), {
            to: 'string'
        })
    }
    // Check if PGS catalog FTP site is down-----------------------
    let response
    response = await fetch(url) // testing url 'https://httpbin.org/status/429'
    if (response?.ok) {
        console.log('PGS file loaded!');
    } else {
        txt = `:( Error loading PGS file. HTTP Response Code: ${response?.status}`
        console.log(txt);
        document.getElementById('pgsTextArea').value = txt
    }
    return txt
}

//---------------------------------------------------------------
// 1. subset ids by traitFile trait_categories and variant number
// 2. subset ids by traitFile label and variant number
// 3. get pgs ids based on trait label, catefory or name

// 1.
// get all trait categories and info
async function getAllCategories(traitCategories, traitFiles, scoringFiles) {
    let outerObj = {}
    traitCategories.map(async x => {
        //console.log("category_______________", x)
        let traitFilesArr = []
        let pgsIds = []
        traitFiles.map(tfile => {
            if (tfile["trait_categories"].includes(x)) {
                //console.log("tfile[trait_categories]",tfile["trait_categories"])
                traitFilesArr.push(tfile)
            }
        })
        if (traitFilesArr.length != 0) {
            pgsIds.push(traitFilesArr.flatMap(x => x.associated_pgs_ids).sort().filter((v, i) => traitFilesArr.flatMap(x => x.associated_pgs_ids).sort().indexOf(v) == i))
        }
        let pgsIds2 = pgsIds.flatMap(x => x)
        //console.log("pgsIds",pgsIds2.length)
        let pgsInfo = pgsIds2.map(id => { // pgs variant number info
           // console.log("let pgsInfo = pgsIds2.map(id => {",id)
            let result = scoringFiles.filter(obj => {
                return obj.id === id
            })
            return result[0]
        })
        let obj = {}
        obj["traitCategory"] = x
        obj["count"] = pgsIds2.length
        obj["pgsIds"] = pgsIds2
        obj["pgsInfo"] = pgsInfo
        obj["traitFiles"] = traitFilesArr
        outerObj[x] = obj;
    })
    return outerObj
}

// subset one category by variant number
async function getPGSidsForOneTraitCategory( category,traitFiles, scoringFiles, varMin, varMax) {
   // console.log("Category::::::1", category, ", var min and max: ", varMin, varMax)
    let categories = Array.from(new Set(traitFiles.flatMap((x,i) => {return x["trait_categories"]}))).sort()

    //console.log("categories2",categories)
    let traitCategories2 =  (await ((await getAllCategories(categories, traitFiles, scoringFiles))[category])).pgsInfo
        // filter ids that don't have variant number/info
        .filter(x => x != undefined)
        .filter(x => x.variants_number < varMax & x.variants_number > varMin)
        traitCategories2.forEach(v => {v.trait_category = category});
        //console.log("traitCategories2", traitCategories2)


    return traitCategories2
}
//-----------------------------------------------------------------------------------------
// 2. label

async function getPGSidsForOneTraitLabel( trait, traitFiles, scoringFiles, varMin, varMax) {
    console.log("getPGSidsForOneTraitLabel:", trait, ", var min and max: ", varMin, varMax)
    let ids = traitFiles
        .filter(x => x.label == trait)
        .map(x => x.associated_pgs_ids)[0]
    let ids2 = scoringFiles
        .filter(x => ids.includes(x.id))
        .filter(x => x != undefined)
        .filter(x => x.variants_number < varMax & x.variants_number > varMin)
    return ids2
}
// 2. ids (EFO)

async function getPGSidsForOneTraitId( trait, traitFiles, scoringFiles, varMin, varMax) {
    console.log("getPGSidsForOneTraiId:", trait, ", var min and max: ", varMin, varMax)
    let ids = traitFiles
        .filter(x => x.id == trait)
        .map(x => x.associated_pgs_ids)[0]
    let ids2 = scoringFiles
        .filter(x => ids.includes(x.id))
        .filter(x => x != undefined)
        .filter(x => x.variants_number < varMax & x.variants_number > varMin)
    return ids2
}
//-----------------------------------------------------------------------------------------
// 3. 
async function getPGSIds(traitType, trait, varMin, varMax){
    let res = ""
    let traitFiles = (await fetchAll2('https://www.pgscatalog.org/rest/trait/all')).flatMap(x => x)
    let scoringFiles = (await fetchAll2('https://www.pgscatalog.org/rest/score/all')).flatMap(x => x)

        if (traitType == "traitLabels") {
            res = await getPGSidsForOneTraitLabel(trait,traitFiles, scoringFiles, varMin, varMax) 
        } else if(traitType == "traitCategories") {
            res = await  getPGSidsForOneTraitCategory( trait,traitFiles, scoringFiles, varMin, varMax,)
        } else if(traitType == "traitIds") {
            res = await  getPGSidsForOneTraitId( trait, traitFiles, scoringFiles, varMin, varMax)
        } else {
            res = "no trait type"
            console.log("invalid trait type given!")
        }
        return res
    }
// Get pgs scores in text format from cache or new--------------------------------
async function getPGSTxtsHm(ids) {
    console.log("getPGSTxtsHm(ids)",ids)
    let data = await Promise.all(ids.map(async (id, i) => {
        console.log("async function getPGSTxtsHm(ids) :",id)
           let score = parsePGS(id, await loadScoreHm(id))
           console.log("id",id)
        return score
    }))
    return data
}
async function getPGSTxts(type = "traitLabels", trait = "type 2 diabetes mellitus", varMin = 0, varMax = 50) {
    let ids = getPGSIds(type, trait, varMin, varMax)
    let data = await Promise.all(ids.map(async (id, i) => {
        let score = await loadScore(id)
        return score
    })
    )
    return data
}

module.exports =

{
    searchTraits,
    getPGSTxts,
    getPGSTxtsHm,
    parsePGS,
    loadScore,
    fetchAll2,
    getAllCategories,
    getPGSidsForOneTraitCategory,
    getPGSidsForOneTraitLabel,
    getPGSIds

}
//module.exports.fetchAll2 = fetchAll2;