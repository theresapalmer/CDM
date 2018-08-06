import * as cdm from "../cdm-types/cdm-types"
import { readFileSync, writeFileSync, readFile, mkdirSync, existsSync, readdirSync, statSync } from "fs";


export function consoleStatusReport(level: cdm.cdmStatusLevel, msg : string, path : string) {
    if (level == cdm.cdmStatusLevel.error)
        console.error(`Err: ${msg} @ ${path}`) ;
    else if (level == cdm.cdmStatusLevel.warning)
        console.warn(`Wrn: ${msg} @ ${path}`);
    else if (level == cdm.cdmStatusLevel.progress)
        console.log(msg);
}

export function resolveLocalCorpus(cdmCorpus : cdm.Corpus, stopLevel : cdm.cdmStatusLevel, statusRpt : cdm.RptCallback) : Promise<boolean> {
    return new Promise<boolean>((localCorpusResolve, localCorpusReject) => {
        console.log('resolving imports');
        // first resolve all of the imports to pull other docs into the namespace
        cdmCorpus.resolveImports((uri : string) : Promise<[string, string]> =>{
            return new Promise<[string, string]>((resolve, reject) => {
                // resolve imports take a callback that askes for promise to do URI resolution.
                // so here we are, working on that promise
                readFile(cdmCorpus.rootPath + uri, "utf8", (err : NodeJS.ErrnoException, data:string)=>{
                    if(err)
                        reject([uri, err]);
                    else
                        resolve([uri, data]);
                })
            });
        }, statusRpt).then((r:boolean) => {
            // success resolving all imports
            console.log(r);
            let startTime = Date.now();
            console.log('validate schema:');
            if (r) {
                let validateStep = (currentStep:cdm.cdmValidationStep)=> {
                    return cdmCorpus.resolveReferencesAndValidate(currentStep, statusRpt, stopLevel).then((nextStep:cdm.cdmValidationStep) => {
                        if (nextStep == cdm.cdmValidationStep.error) {
                            console.log('validation step failed');
                        }
                        else if (nextStep == cdm.cdmValidationStep.finished) {
                            console.log('validation finished');
                            console.log(Date.now() - startTime);
                            localCorpusResolve(true);
                        }
                        else {
                            // success resolving all imports
                            return validateStep(nextStep);
                        }
                    }).catch((reason)=> {
                        console.log('exception during validation');
                        console.log(reason);
                        localCorpusReject(reason);
                    });
                }
                return validateStep(cdm.cdmValidationStep.start);
            }
        });
    });
}

// "analyticalCommon"
// "applicationCommon"

export function loadCorpusFolder(corpus : cdm.Corpus, folder : cdm.ICdmFolderDef, ignoreFolders : string[], version : string) {
    let path = corpus.rootPath + folder.getRelativePath();
    if (ignoreFolders && ignoreFolders.find(ig => ig == folder.getName()))
        return;
    let endMatch = (version ? "." + version : "" )+ ".cdm.json";
    // for every document or directory
    readdirSync(path).forEach(dirEntry => {
        let entryName = path + dirEntry;
        let stats = statSync(entryName);
        if (stats.isDirectory()) {
            this.loadCorpusFolder(corpus, folder.addFolder(dirEntry), ignoreFolders, version);
        }
        else {
            let postfix = dirEntry.slice(dirEntry.indexOf("."));
            if (postfix == endMatch) {
                let sourceDoc = readFileSync(entryName, "utf8");
                corpus.addDocumentFromContent(folder.getRelativePath() +  dirEntry, sourceDoc);
            }
        }
    });
}


export function persistCorpus(cdmCorpus : cdm.Corpus) {
    if (cdmCorpus && cdmCorpus.getSubFolders() && cdmCorpus.getSubFolders().length == 1) 
        persistCorpusFolder(cdmCorpus.rootPath, cdmCorpus.getSubFolders()[0]);
}

export function persistCorpusFolder(rootPath : string, cdmFolder : cdm.ICdmFolderDef): void {
    if (cdmFolder) {
        let folderPath = rootPath + cdmFolder.getRelativePath();
        if (!existsSync(folderPath))
            mkdirSync(folderPath);
        if (cdmFolder.getDocuments())
            cdmFolder.getDocuments().forEach(doc => {
                let content = JSON.stringify(doc, null, 4);
                writeFileSync(folderPath + doc.getName(), content, "utf8");
            });
        if (cdmFolder.getSubFolders()) {
            cdmFolder.getSubFolders().forEach(f => {
                persistCorpusFolder(rootPath, f);
            });
        }
    }
}

