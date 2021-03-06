import {UIElement} from "../UI/UIElement";
import {UIEventSource} from "../Logic/UIEventSource";
import {And, Tag, TagsFilter, TagUtils} from "../Logic/TagsFilter";
import {FixedUiElement} from "../UI/Base/FixedUiElement";
import {SaveButton} from "../UI/SaveButton";
import {VariableUiElement} from "../UI/Base/VariableUIElement";
import {TagDependantUIElement} from "./UIElementConstructor";
import {TextField} from "../UI/Input/TextField";
import {InputElement} from "../UI/Input/InputElement";
import {InputElementWrapper} from "../UI/Input/InputElementWrapper";
import {FixedInputElement} from "../UI/Input/FixedInputElement";
import {RadioButton} from "../UI/Input/RadioButton";
import Translations from "../UI/i18n/Translations";
import Locale from "../UI/i18n/Locale";
import {State} from "../State";
import {TagRenderingOptions} from "./TagRenderingOptions";


export class TagRendering extends UIElement implements TagDependantUIElement {


    private _priority: number;


    private _question: UIElement;
    private _mapping: { k: TagsFilter, txt: string | UIElement, priority?: number }[];

    private _tagsPreprocessor?: ((tags: any) => any);
    private _freeform: {
        key: string, 
        template: string | UIElement,
        renderTemplate: string | UIElement,
        placeholder?: string | UIElement,
        extraTags?: TagsFilter
    };


    private readonly _questionElement: InputElement<TagsFilter>;

    private readonly _saveButton: UIElement;
    private readonly _skipButton: UIElement;
    private readonly _editButton: UIElement;

    private readonly _questionSkipped: UIEventSource<boolean> = new UIEventSource<boolean>(false);

    private readonly _editMode: UIEventSource<boolean> = new UIEventSource<boolean>(false);


    private static injected = TagRendering.injectFunction(); 
    static injectFunction() {
        // This is a workaround as not to import tagrendering into TagREnderingOptions
        TagRenderingOptions.tagRendering = (tags, options) => new TagRendering(tags, options);
        return true;
    }

    constructor(tags: UIEventSource<any>, options: {
        priority?: number

        question?: string | UIElement,

        freeform?: {
            key: string,
            template: string | UIElement,
            renderTemplate: string | UIElement,
            placeholder?: string | UIElement,
            extraTags?: TagsFilter,
        },
        tagsPreprocessor?: ((tags: any) => any),
        mappings?: { k: TagsFilter, txt: string | UIElement, priority?: number, substitute?: boolean }[]
    }) {
        super(tags);
        this.ListenTo(Locale.language);
        this.ListenTo(this._questionSkipped);
        this.ListenTo(this._editMode);
        this.ListenTo(State.state.osmConnection.userDetails);


        const self = this;
       
        this._priority = options.priority ?? 0;
        this._tagsPreprocessor = function (properties) {
            if (options.tagsPreprocessor === undefined) {
                return properties;
            }
            const newTags = {};
            for (const k in properties) {
                newTags[k] = properties[k];
            }
            options.tagsPreprocessor(newTags);
            return newTags;
        };

        if (options.question !== undefined) {
            this._question = this.ApplyTemplate(options.question);
        }
        
        this._mapping = [];
        this._freeform = options.freeform;


        for (const choice of options.mappings ?? []) {
            let choiceSubbed = {
                k: choice.k,
                txt: choice.txt,
                priority: choice.priority
            };

            if (choice.substitute) {
                choiceSubbed = {
                    k: choice.k.substituteValues(
                        options.tagsPreprocessor(this._source.data)),
                    txt: choice.txt,
                    priority: choice.priority
                }
            }


            this._mapping.push({
                k: choiceSubbed.k,
                txt: choiceSubbed.txt
            });
        }


        // Prepare the actual input element -> pick an appropriate implementation

        this._questionElement = this.InputElementFor(options);
        const save = () => {
            const selection = self._questionElement.GetValue().data;
            if (selection) {
                State.state.changes.addTag(tags.data.id, selection);
            }
            self._editMode.setData(false);
        }

        const cancel = () => {
            self._questionSkipped.setData(true);
            self._editMode.setData(false);
            self._source.ping(); // Send a ping upstream to render the next question
        }

        // Setup the save button and it's action
        this._saveButton = new SaveButton(this._questionElement.GetValue())
            .onClick(save);

        this._editButton = new FixedUiElement("");
        if (this._question !== undefined) {
            this._editButton = new FixedUiElement("<img class='editbutton' src='./assets/pencil.svg' alt='edit'>")
                .onClick(() => {
                    self._editMode.setData(true);
                    self._questionElement.GetValue().setData(self.CurrentValue());
                });
        }


        const cancelContents = this._editMode.map((isEditing) => {
            if (isEditing) {
                return "<span class='skip-button'>"+Translations.t.general.cancel.R()+"</span>";
            } else {
                return "<span class='skip-button'>"+Translations.t.general.skip.R()+"</span>";
            }
        }, [Locale.language]);
        // And at last, set up the skip button
        this._skipButton = new VariableUiElement(cancelContents).onClick(cancel)    ;
    }


    private InputElementFor(options: {
        freeform?: {
            key: string, 
            template: string | UIElement,
            renderTemplate: string | UIElement,
            placeholder?: string | UIElement,
            extraTags?: TagsFilter,
        },
        mappings?: { k: TagsFilter, txt: string | UIElement, priority?: number, substitute?: boolean }[]
    }):
        InputElement<TagsFilter> {

        const elements = [];

        if (options.mappings !== undefined) {
            
            const previousTexts= [];
            for (const mapping of options.mappings) {
                if(mapping.k === null){
                    continue;
                }
                if(previousTexts.indexOf(mapping.txt) >= 0){
                    continue;
                }
                previousTexts.push(mapping.txt);
                
                elements.push(this.InputElementForMapping(mapping));
            }
        }

        if (options.freeform !== undefined) {
            elements.push(this.InputForFreeForm(options.freeform));
        }


        if (elements.length == 0) {
            //console.warn("WARNING: no tagrendering with following options:", options);
            return new FixedInputElement("This should not happen: no tag renderings defined", undefined);
        }
        if (elements.length == 1) {
            return elements[0];
        }

        return new RadioButton(elements, false);

    }


    private InputElementForMapping(mapping: { k: TagsFilter, txt: string | UIElement }) {
        return new FixedInputElement(mapping.txt, mapping.k);
    }


    private InputForFreeForm(freeform): InputElement<TagsFilter> {
        if (freeform === undefined) {
            return undefined;
        }

        const prepost = Translations.W(freeform.template).InnerRender()
            .replace("$$$","$string$")
            .split("$");
        const type = prepost[1];
        
        let isValid = TagRenderingOptions.inputValidation[type];
        if (isValid === undefined) {
            isValid = (str) => true;
        }
        let formatter = TagRenderingOptions.formatting[type] ?? ((str) => str);

        const pickString =
            (string: any) => {
                if (string === "" || string === undefined) {
                    return undefined;
                }
                if (!isValid(string, this._source.data._country)) {
                    return undefined;
                }
                const tag = new Tag(freeform.key, formatter(string, this._source.data._country));
                
                if (freeform.extraTags === undefined) {
                    return tag;
                }
                return new And([
                        tag,
                        freeform.extraTags
                    ]
                );
            };

        const toString =
            (tag) => {
                if (tag instanceof And) {
                    return toString(tag.and[0])
                } else if (tag instanceof Tag) {
                    return tag.value
                }
                return undefined;
            }


        let inputElement: InputElement<TagsFilter>;
        const textField = new TextField({
            placeholder: this._freeform.placeholder,
            fromString: pickString,
            toString: toString
        });

        return new InputElementWrapper(prepost[0], textField, prepost[2]);
    }


    IsKnown(): boolean {
        const tags = TagUtils.proprtiesToKV(this._source.data);

        for (const oneOnOneElement of this._mapping) {
            if (oneOnOneElement.k === null || oneOnOneElement.k.matches(tags)) {
                return true;
            }
        }

        return this._freeform !== undefined && this._source.data[this._freeform.key] !== undefined;
    }

    IsSkipped(): boolean {
        return this._questionSkipped.data;
    }

    private CurrentValue(): TagsFilter {
        const tags = TagUtils.proprtiesToKV(this._source.data);

        for (const oneOnOneElement of this._mapping) {
            if (oneOnOneElement.k !== null && oneOnOneElement.k.matches(tags)) {
                return oneOnOneElement.k;
            }
        }
        if (this._freeform === undefined) {
            return undefined;
        }

        return new Tag(this._freeform.key, this._source.data[this._freeform.key]);
    }


    IsQuestioning(): boolean {
        if (this.IsKnown()) {
            return false;
        }
        if (this._question === undefined) {
            // We don't ask this question in the first place
            return false;
        }
        if (this._questionSkipped.data) {
            // We don't ask for this question anymore, skipped by user
            return false;
        }
        return true;
    }

    private RenderAnwser(): UIElement {
        const tags = TagUtils.proprtiesToKV(this._source.data);

        let freeform: UIElement = new FixedUiElement("");
        let freeformScore = -10;
        if (this._freeform !== undefined && this._source.data[this._freeform.key] !== undefined) {
            freeform = this.ApplyTemplate(this._freeform.renderTemplate);
            freeformScore = 0;
        }


        let highestScore = -100;
        let highestTemplate = undefined;
        for (const oneOnOneElement of this._mapping) {
            if (oneOnOneElement.k == null ||
                oneOnOneElement.k.matches(tags)) {
                // We have found a matching key -> we use the template, but only if it scores better
                let score = oneOnOneElement.priority ??
                    (oneOnOneElement.k === null ? -1 : 0);
                if (score > highestScore) {
                    highestScore = score;
                    highestTemplate = oneOnOneElement.txt
                }
            }
        }

        if (freeformScore > highestScore) {
            return freeform;
        }

        if (highestTemplate !== undefined) {
            // we render the found template
            return this.ApplyTemplate(highestTemplate);
        }


    }

    InnerRender(): string {
        if (this.IsQuestioning() || this._editMode.data) {
            // Not yet known or questioning, we have to ask a question

            const question =
                this.ApplyTemplate(this._question).Render();

            return "<div class='question'>" +
                "<span class='question-text'>" + question + "</span>" +
                (this._question.IsEmpty() ? "" : "<br/>") +
                "<div>" + this._questionElement.Render() + "</div>" +
                this._skipButton.Render() +
                this._saveButton.Render() +
                "</div>"
        }

        if (this.IsKnown()) {
            const answer = this.RenderAnwser()
            if (answer.IsEmpty()) {
                return "";
            }
            const html = answer.Render();
            let editButton = "";
            if (State.state.osmConnection.userDetails.data.loggedIn && this._question !== undefined) {
                editButton = this._editButton.Render();
            }

            return "<span class='answer'>" +
                "<span class='answer-text'>" + html + "</span>" +
                editButton +
                "</span>";
        }

        return "";

    }


    Priority(): number {
        return this._priority;
    }

    private ApplyTemplate(template: string | UIElement): UIElement {
        if (template === undefined || template === null) {
            throw "Trying to apply a template, but the template is null/undefined"
        }
        
        const contents = Translations.W(template).map(contents => 
            {
                let templateStr = "";
                if (template instanceof UIElement) {
                    templateStr = template.Render();
                } else {
                    templateStr = template;
                }
                const tags = this._tagsPreprocessor(this._source.data);
                return TagUtils.ApplyTemplate(templateStr, tags);
            }, [this._source]
        );
        return new VariableUiElement(contents);
    }


 
}