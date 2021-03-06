var pubsub = require("pubsub.js");

function CommentContext(doc, comment) {
    comment = comment || {};

    Object.defineProperties(this, {
        "_doc" : {
            "value" : doc,
        },
        "_parent" : {
            "value" : undefined,
        },
        "_children" : {
            "value" : [],
        },
    });

    this.isClass    = false;
    this.isModule   = false;
    this.isFunction = false;
    this.isConstant = false;
    this.isIgnored  = false;
    this.isEnum     = false;
    this.isPrivate  = comment.isPrivate || false;

    this.name       = "";
    this.types      = [];
    this.see        = {};
    this.value      = "";
    this.parentName = "";

    this.params     = [];
    this.returns    = {};

    this.tags           = comment.tags || [];
    this.description    = comment.description || "";
    this.body           = comment.body || "";
    this.content        = comment.content || "";
    this.code           = comment.code || "";
    this.ctx            = comment.ctx || {};

    this.processTags();
}

CommentContext.prototype.processTags = function () {
    this.tags.forEach(function (tag) {
        switch (tag.type) {
        case "class":
            this.isClass = true;
            break;

        case "module":
            this.isModule = true;
            break;

        case "function":
            this.isFunction = true;
            break;

        case "constant":
            this.isConstant = true;
            break;

        case "enum":
            this.isEnum = true;
            break;

        case "ignore":
            this.isIgnored = true;
            break;

        case "private":
            this.isPrivate = true;
            break;

        case "name":
            this.name = tag.string;
            break;

        case "type":
            this.types = this.types.concat(tag.types);
            break;

        case "see":
            this.see = tag;
            break;

        case "default":
            this.value = tag.string;
            break;

        case "param":
            this.params.push(tag);
            break;

        case "return":
            this.returns = tag;
            break;

        case "memberOf":
            this.parentName = tag.parent;
            this._doc.getClass(tag.parent).then(function (cls) {
                cls.addChild(this);
            }.bind(this));
            break;

        case "kind":
            switch (tag.string) {
            case "class":
                this.isClass = true;
                break;

            case "function":
                this.isFunction = true;
                break;

            case "constant":
                this.isConstant = true;
                break;

            case "enum":
                this.isEnum = true;
                break;

            default:
                console.warn("Unrecognized kind:", tag);
                break;
            }
            break;

        default:
            console.warn("Unrecognized tag:", tag);
            break;
        }
    }.bind(this));
};

CommentContext.prototype.addChild = function (child) {
    this._children.push(child);
    child._parent = this;
};

CommentContext.prototype.getChildren = function (name) {
    return this._children.filter(function (child) {
        return child.name === name;
    });
};

CommentContext.prototype.getFirstChild = function (name) {
    return this._children.reduce(function (prev, current) {
        return (
            prev && (prev.name === name) ? prev :
            current && (current.name === name) ? current :
            undefined
        );
    }, null);
};

CommentContext.prototype.getLastChild = function (name) {
    return this._children.reduceRight(function (prev, current) {
        return (
            prev && (prev.name === name) ? prev :
            current && (current.name === name) ? current :
            undefined
        );
    }, null);
};


function DocContext(options) {
    this.options    = options;
    this.readme     = "";
    this.comments   = [];

    this.classes    = {};
    this.modules    = {};
    this.functions  = {};
    this.constants  = {};
    this.misc       = [];
}

DocContext.prototype.processReadme = function (readme) {
    var marked = require("marked");

    // Custom markdown rendering
    var renderer = new marked.Renderer();

    renderer.codespan = function (code) {
        return "<kbd>" + code + "</kbd>";
    };

    var heading = renderer.heading;
    renderer.heading = function (text, level, raw) {
        return heading.call(this, text, level, raw) + (level < 3 ? "<hr>" : "");
    }

    // Render readme
    this.readme = marked(readme, {
        "renderer" : renderer,
    });
};

DocContext.prototype.addSource = function (src) {
    var dox = require("dox");
    this.comments = this.comments.concat(dox.parseComments(src));
};

DocContext.prototype.processSource = function () {
    this.comments.forEach(function (comment) {
        var ctx = new CommentContext(this, comment);

        if (ctx.isIgnored) {
            return;
        }

        if (ctx.isClass) {
            if (!(ctx.name in this.classes)) {
                this.classes[ctx.name] = ctx;
                var className = (ctx.parentName ? ctx.parentName + "." : "") + ctx.name;
                pubsub.publish("resolve:" + className, [ ctx ]);
            }
        }
        else if (ctx.isModule) {
            if (!(ctx.name in this.modules)) {
                this.modules[ctx.name] = ctx;
                var className = (ctx.parentName ? ctx.parentName + "." : "") + ctx.name;
                pubsub.publish("resolve:" + className, [ ctx ]);
            }
        }
        else if (ctx.isFunction) {
            if (!(ctx.name in this.functions)) {
                this.functions[ctx.name] = ctx;
            }
        }
        else if (ctx.isConstant || ctx.isEnum) {
            if (!(ctx.name in this.constants)) {
                this.constants[ctx.name] = ctx;
            }
        }
        else {
            if (this.options.verbose) {
                console.warn(
                    "Unrecognized comment kind:",
                    JSON.stringify(ctx, null, 2)
                );
            }
            this.misc.push(ctx);
        }
    }.bind(this));
};

DocContext.prototype.getClass = function (className) {
    var self = this;
    var parts = className.split(".");
    var name = parts.shift();
    var ctx = this.classes[name] || this.modules[name];

    function walkParts(ctx, resolve) {
        var tmp = [ name ];

        if (parts.every(function (part) {
            tmp.push(part);
            ctx = ctx.getFirstChild(part);
            if (!ctx) {
                // XXX
                console.log("* TODO: waiting for:", tmp.join("."));
                //pubsub.subscribeOnce("resolve:" + tmp.join("."), function () {
                    // ...
                //});
            }
            return ctx;
        })) {
            resolve(ctx);
        }
    }

    return new Promise(function (resolve, reject) {
        if (ctx) {
            walkParts(ctx, resolve);
        }
        else {
            pubsub.subscribeOnce("resolve:" + className, function (ctx) {
                walkParts(ctx, resolve);
            });
        }
    });
};


exports.CommentContext = CommentContext;
exports.DocContext = DocContext;
