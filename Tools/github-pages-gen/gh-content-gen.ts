import * as cdm from "../cdm-types/cdm-types"
import { readFileSync, writeFileSync, readFile, mkdirSync, existsSync, createReadStream, readdirSync, statSync } from "fs";
import { relative } from "path";

export interface entityState {
    id : string;
    folderId : string;
    name : string;
    path : string;
    docName : string;
    UEName : string;
    loadState : number;
    description : string;
    createUX : boolean;
}

export interface folder {
    id : string;
    name : string
    entities : entityState[];
    folders : folder[];
}


export interface navigatorData {
    root : folder;  
    readRoot : string;
    sourceRoot : string;
}

export interface indexEntry {
    name : string;
    jsonLink : string;
    locationFragment : string;
    locationLink : string;
    documentationLink : string;
    level : number;
    description : string;
}

export interface contentConstants {
    docsRoot : string;
    coreDir : string;
    docLocationRoot : string;
    ghSourceRoot : string;
    ghRawRoot : string;
    brTemplate : string;
    brTokenScript : string;
    brTokenHTML : string;
    brResultFile : string;
    mdTemplate : string;
    mdToken : string;
} 

export function collectGithubFolderData(corpus : cdm.Corpus) : folder {
    let collectFolderHierarchy = (folder : cdm.ICdmFolderDef, hier : folder) => {
        folderId ++;
        let entNumber = 0;
        hier.name = folder.getName();
        hier.id = "f" + (folderId * 10000).toString();
        if (folder.getName() != "" && folder.getDocuments() && folder.getDocuments().length)
        {
            hier.entities = new Array<entityState>();
            folder.getDocuments().forEach(doc => {
                if (doc.getDefinitions() && doc.getDefinitions().length)
                    doc.getDefinitions().forEach(def => {
                        if (def.getObjectType() == cdm.cdmObjectType.entityDef) {
                            entNumber ++;
                            let id = "e" + (entNumber + folderId * 10000).toString();
                            // for each entity defined 
                            // get description
                            let UEName : string;
                            let description = "";
                            let locEnt : cdm.ICdmConstantEntityDef;
                            let pVal: cdm.ParameterValue;
                            let rtDesc : cdm.ResolvedTrait;
                            if ((rtDesc = def.getResolvedTraits().find("is.localized.describedAs")) && 
                                (pVal=rtDesc.parameterValues.getParameterValue("localizedDisplayText")) &&
                                (pVal.value) && 
                                (locEnt = pVal.value.getObjectDef() as cdm.ICdmConstantEntityDef)) {
                                    description = locEnt.lookupWhere("displayText", "languageTag", "en");
                            }
                            if ((rtDesc = def.getResolvedTraits().find("is.CDS.sourceNamed")) &&
                                (pVal = rtDesc.parameterValues.getParameterValue("name")))
                                UEName = pVal.valueString;
                            if (!UEName)
                                UEName = def.getName();

                            hier.entities.push({id:id, folderId:hier.id, name:def.getName(), path:folder.getRelativePath(), 
                                                docName:doc.getName(), loadState : 0, description : description, UEName : UEName, createUX : true});
                        }
                    });
                
            });
        }
        if (folder.getSubFolders() && folder.getSubFolders().length)
        {
            hier.folders = new Array<folder>();
            folder.getSubFolders().forEach(sub => {
                let subHier : folder = {id:"0", name:undefined, entities:undefined, folders:undefined}
                hier.folders.push(subHier);
                collectFolderHierarchy(sub, subHier);
            });
        }
    }

    let stateList = new Array<entityState>();
    let hierRoot : folder = {id:"0", name:"", entities:undefined, folders:undefined};
    let folderId = 0;
    collectFolderHierarchy(corpus, hierRoot)
    return hierRoot;
}

export function createGithubBrowser(hierRoot : folder, consts : contentConstants) {

    let navData : navigatorData = {readRoot:consts.ghRawRoot, sourceRoot:consts.ghSourceRoot, root:hierRoot };
    let dataChunk = JSON.stringify(navData);

    // read the template html and break it into chunks
    let fullTemplate = readFileSync(consts.brTemplate, {encoding:"utf-8"});
    let content = fullTemplate.replace(consts.brTokenScript, dataChunk);

    // write the result
    writeFileSync(consts.brResultFile, content, {encoding:"utf-8"});
}


export function createGithubIndex(hierRoot : folder, consts : contentConstants) {
    
    let createMarkdownIndex = (path : string, hier : folder, locationParent : string, locationThis : string) => { 
        let content = "";
        let appendLine = (toAdd : string) => {
            content += toAdd + "\n";
        }

        let makeLocationFragment = (locationParent : string, locationThis : string) : string => {
            if (locationParent) 
                return `${locationParent}/${locationThis}/`;
            else if (locationThis)
                return `${locationThis}/`;
            return undefined;
        }

        let locationFragment = makeLocationFragment(locationParent, locationThis) ;
        if (locationFragment)
            appendLine(`## ${locationFragment}`);

        let collectAllEntities = (hier : folder, locationParent : string, locationThis : string, level : number, accumulateIn : Array<indexEntry>) => {
            let locationFragment = makeLocationFragment(locationParent, locationThis);

            if (hier.entities) {
                hier.entities.forEach(ent => {
                    accumulateIn.push({name : ent.name, 
                                    jsonLink : consts.ghSourceRoot + ent.path + ent.docName,
                                    locationFragment : locationFragment,
                                    locationLink : consts.ghSourceRoot + ent.path,
                                    description : ent.description,
                                    documentationLink : consts.docLocationRoot + ent.UEName,
                                    level : level});
                });
            }
            if (hier.folders) {
                hier.folders.forEach(fold => {
                    collectAllEntities(fold, locationThis, fold.name, level + 1, accumulateIn);
                });
            }
        }

        let allIndex = new Array<indexEntry>();
        let dupName = false;
        collectAllEntities(hier, "", locationThis, 0, allIndex);
        // sort by entity name and level
        allIndex = allIndex.sort((l, r) : number => { 
            if (l.name < r.name)
                return -1;
            if (l.name > r.name)
                return 1;
            dupName = true;
            if (l.level < r.level)
                return -1;
            if (l.level > r.level)
                return 1;
            return 0;
        });

        if (dupName) {
            appendLine(">Note: Entities with multiple rows in the index below indicate that there is a base version of the entity (first occurrence), as well as extended versions with additional attributes added (e.g.with Sales / Services / Marketing specific additions)");
            appendLine("");
        }
    
        appendLine("| Entity Name | Location: | Description | External Link |");
        appendLine("|:--- |:--- |:--- |:--- |");

        allIndex.forEach(i => {
            content += `|[**${i.name}**](${i.jsonLink})|`;

            if (i.locationFragment != null)
                content += `[${i.locationFragment}](${i.locationLink})|`;
            else
                content += " |";

            if (i.description!= null)
                    content += `${i.description}|`;
            else
                content += " |";

            appendLine(`[Docs](${i.documentationLink})|`);
        });



        if (!locationFragment) {
            // special case for the top directory, insert the link to the nav tool and other help
            let template = readFileSync(consts.mdTemplate, "utf8");
            content = template.replace(consts.mdToken, content);
        }

        writeFileSync(path + "README.md", content, {encoding:"utf-8"});

        if (hier.folders) {
            hier.folders.forEach(fold => {
                createMarkdownIndex(path + fold.name + "/", fold, locationThis, fold.name);
            });
        }
    }

    createMarkdownIndex(consts.coreDir, hierRoot, "", "");
}
