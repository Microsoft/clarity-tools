/// <reference path="../../../node_modules/clarity-js/clarity.d.ts" />
import { IParser } from "../components/Snapshot";
import { IAttributes, ILayoutState, IElementLayoutState, IDoctypeLayoutState, ITextLayoutState, IIgnoreLayoutState, Action } from "clarity-js/clarity";

export class Layout implements IParser {
    protected layouts: { [index: number]: Node } = {};
    protected base: string;
    protected document: Document;
    protected svgns: string = "http://www.w3.org/2000/svg";
    protected placeholderImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAMSURBVBhXY2BgYAAAAAQAAVzN/2kAAAAASUVORK5CYII=";

    protected attributes(node: HTMLElement, attributes: IAttributes) {
        if (attributes) {
            for (let attribute in attributes) {
                if (attribute) {
                    try {
                        let value = attributes[attribute];
                        if (attribute === "value") {
                            node[attribute] = value;
                        }
                        node.setAttribute(attribute, value);
                    }
                    catch (ex) {
                        console.warn("Setting attributes on a node: " + ex);
                    }
                }
            }
        }
    }

    setup(document: Document, frame: HTMLIFrameElement, base: string, thumbnail? : boolean) {
        this.layouts = {};
        this.document = document;
        this.base = base;
    }

    protected domInsert(node: Node, parent?: Node, nextSibling?: Node) {
        if (parent) {
            if (nextSibling && nextSibling.parentNode === parent) {
                nextSibling.parentNode.insertBefore(node, nextSibling);
            }
            else {
                try {
                    parent.appendChild(node);
                }
                catch (ex) {
                    console.warn("Error while inserting a node: " + ex);
                }
            }
            return node;
        }
        return null;
    }

    protected domRemove(node: Node) {
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
        }
        else {
            console.warn(`Remove: Cannot remove ${node}`);
        }
        return null;
    }

    protected createElement(state: ILayoutState, parent): HTMLElement {
        if (state.tag === "svg") {
            return <HTMLElement>this.document.createElementNS(this.svgns, state.tag);
        }
        else {
            while (parent && parent.tagName !== "BODY") {
                if (parent.tagName === "svg") {
                    return <HTMLElement>this.document.createElementNS(this.svgns, state.tag);
                }
                parent = parent.parentNode;
            }
        }

        return this.document.createElement(state.tag);
    }

    protected insert(layoutState: ILayoutState) {
        var doc = this.document;
        var state: any = layoutState as IElementLayoutState;
        var parent = this.layouts[state.parent];
        var next = state.next in this.layouts ? this.layouts[state.next] : null;
        switch (state.tag) {
            case "*DOC*":
                state = layoutState as IDoctypeLayoutState;
                if (typeof XMLSerializer !== "undefined") {
                    this.layouts = {};
                    doc.open();
                    doc.write(new XMLSerializer().serializeToString(
                        this.document.implementation.createDocumentType(
                            state.attributes["name"],
                            state.attributes["publicId"],
                            state.attributes["systemId"]
                        )
                    ));
                    doc.close();
                }
                this.layouts[state.index] = doc;
                break;
            case "HTML":
                var newDoc = this.document.implementation.createHTMLDocument('');
                var html = newDoc.documentElement;
                this.attributes(html, state.attributes);
                var pointer = doc.importNode(html, true);
                doc.replaceChild(pointer, doc.documentElement);
                if (doc.head) doc.head.parentNode.removeChild(doc.head);
                if (doc.body) doc.body.parentNode.removeChild(doc.body);
                this.layouts[state.index] = doc.documentElement;
                break;
            case "HEAD":
                let headNode = this.document.createElement(state.tag);
                this.attributes(headNode, state.attributes);
                var baseTag = this.document.createElement("base");
                baseTag.href = this.base;
                headNode.appendChild(baseTag);
                parent.appendChild(headNode);
                this.layouts[state.index] = headNode;
                break;
            case "*TXT*":
                state = layoutState as ITextLayoutState;
                var txt = this.document.createTextNode(state.content);
                this.layouts[state.index] = this.domInsert(txt, parent, next);
                break;
            case "OBJECT":
                break;
            case "IFRAME":
                if (!state.layout) break;
            case "IMG":
                var img = <HTMLImageElement>this.createElement(state, parent);
                this.attributes(img, state.attributes);
                if (!img.src)
                {
                    img.src = this.placeholderImage;
                    img.style.width = state.layout.width + "px";
                    img.style.height = state.layout.height + "px"; 
                }
                this.insertHelper(state, img);
                this.layouts[state.index] = this.domInsert(img, parent, next);
                break;
            case "*IGNORE*":
                state = layoutState as IIgnoreLayoutState;
                var ignoredNode = this.document.createElement("div");
                // Ensure that this ignore node doesn't disrupt the layout of other elements
                ignoredNode.style.display = "none";
                ignoredNode.setAttribute("data-index", state.index);
                ignoredNode.setAttribute("data-nodeType", state.nodeType);
                /* nodeType --> 1: ELEMENT_NODE | 3: TEXT_NODE | 8: COMMENT_NODE */
                if (state.nodeType === 1) {
                    ignoredNode.setAttribute("data-tagName", state.elementTag);
                }
                this.layouts[state.index] = this.domInsert(ignoredNode, parent, next);
                break;
            default:
                let node = this.createElement(state, parent);
                this.attributes(node, state.attributes);
                // Check if this element can be scrolled
                if (state.layout && (state.layout.scrollX || state.layout.scrollY)) {
                    node.scrollLeft = state.layout.scrollX;
                    node.scrollTop = state.layout.scrollY;
                }
                if (node.tagName === "STYLE" && state.cssRules) {
                    for (let i = 0; i < state.cssRules.length; i++) {
                        let textNode = document.createTextNode(state.cssRules[i]);
                        node.appendChild(textNode);
                    }
                }
                this.layouts[state.index] = this.domInsert(node, parent, next);
                break;
        }
    }

    protected update(state: IElementLayoutState) {
        var node = <HTMLElement>this.layouts[state.index];
        if (node) {
            // First remove all its existing attributes
            if (node.attributes) { 
                var attributes = node.attributes.length;
                while (node.attributes && attributes > 0) {
                    node.removeAttribute(node.attributes[0].name);
                    attributes--;
                } 
            }       
            // Then, update attributes from the new received event state
            this.attributes(node, state.attributes);
            // Special handling for image nodes
            if (node.tagName === "IMG") {
                let img = <HTMLImageElement> node;
                if (!img.src)
                {
                    img.src = this.placeholderImage;
                    img.style.width = state.layout.width + "px";
                    img.style.height = state.layout.height + "px";
                }
                this.insertHelper(state, img);
            }
            // If we have content for this node
            if (state.tag === "*TXT*" && (<ITextLayoutState>(state as ILayoutState)).content) {
                node.nodeValue = (<ITextLayoutState>(state as ILayoutState)).content;
            }
            // Check if this element can be scrolled
            if (state.layout && (state.layout.scrollX || state.layout.scrollY)) {
                node.scrollLeft = state.layout.scrollX;
                node.scrollTop = state.layout.scrollY;
            }
            this.layouts[state.index] = node;
        }
        else {
            console.warn(`Move: ${node} doesn't exist`);
        }
    }

    protected remove(state: ILayoutState) {
        this.layouts[state.index] = this.domRemove(this.layouts[state.index]);
    }

    protected move(state: ILayoutState) {
        var node = this.layouts[state.index];
        var parent = this.layouts[state.parent];
        var next = state.next in this.layouts ? this.layouts[state.next] : null;
        if (node && parent) {
            this.layouts[state.index] = this.domInsert(node, parent, next);
        }
        else {
            console.warn(`Move: ${node} or ${parent} doesn't exist`);
        }
    }

    protected insertHelper(state: IElementLayoutState, img: HTMLImageElement){
        return;
    }

    reset() {}

    render(state: IElementLayoutState) {
        switch (state.action) {
            case Action.Insert:
                this.insert(state);
                break;
            case Action.Update:
                this.update(state);
                break;
            case Action.Remove:
                this.remove(state);
                break;
            case Action.Move:
                this.move(state);
                break;
        }
    }
}