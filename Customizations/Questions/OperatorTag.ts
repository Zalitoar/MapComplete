import {Changes} from "../../Logic/Osm/Changes";
import {Tag} from "../../Logic/TagsFilter";
import {TagRenderingOptions} from "../TagRenderingOptions";


export class OperatorTag extends TagRenderingOptions {


    private static options = {
        priority: 15,
        question: "Wie beheert dit gebied?",
        freeform: {
            key: "operator",
            template: "Beheer door $$$",
            renderTemplate: "Beheer door {operator}",
            placeholder: "organisatie"
        },
        mappings: [
            {k: new Tag("operator", "Natuurpunt"), txt: "Natuurpunt"},
            {k: new Tag("operator", "Agentschap Natuur en Bos"), txt: "het Agentschap Natuur en Bos (ANB)"},
            {k: new Tag("operator", "private"), txt: "Beheer door een privépersoon"}
        ]
    }

    constructor() {
        super(OperatorTag.options);
    }

}