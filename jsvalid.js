// jsvalid.js
// James Diacono
// 2021-06-29

// Public Domain

const violation_messages = {
    not_type_a: "Not of type {a}.",
    not_wun_of: "Not a valid option.",
    not_equal_to_a: "Not equal to '{a}'.",
    not_finite: "Not a finite number.",
    out_of_bounds: "Out of bounds.",
    wrong_pattern: "Wrong pattern.",
    missing_property_a: "Missing property '{a}'.",
    unknown_key_a: "Unknown key '{a}'.",
    unexpected_element: "Unexpected element.",
    unexpected_property_a: "Unexpected property '{a}'."
};

function interpolate(template, container) {
    return template.replace(/\{([^{}]*)\}/g, function (original, filling) {
        try {
            return String(container[filling]);
        } catch (ignore) {

// Objects with a null prototype are unprintable. Perhaps other values are too.

            return original;
        }
    });
}

function coalesce(left, right) {

// The nullish coalescing operator (??) as a function, for compatibility with
// older JavaScript engines.

    return (
        left === undefined
        ? right
        : left
    );
}

function make_violation(code, ...exhibits) {
    const exhibits_object = exhibits.reduce(function (
        object,
        exhibit,
        exhibit_nr
    ) {

// The exhibit names are "a", "b", etc.

        const exhibit_name = String.fromCharCode(97 + exhibit_nr);
        object[exhibit_name] = exhibit;
        return object;
    }, {});
    return Object.assign(
        {
            message: interpolate(violation_messages[code], exhibits_object),
            code
        },
        exhibits_object
    );
}

function report_pass() {

// Returns a successful report.

    return {
        violations: []
    };
}

function report_fail(...args) {

// Returns an unsuccessful report containing a single violation.

    return {
        violations: [make_violation(...args)]
    };
}

function typeof_as_a_function(value) {

// Wrapping typeof in a function avoids a JSLint warning (it always expects a
// string literal on the right side of typeof).

    return typeof value;
}

function is_object(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

// The validator factories. ////////////////////////////////////////////////////

function type(type) {
    return function (subject) {
        return (
            typeof_as_a_function(subject) !== type
            ? report_fail("not_type_a", type)
            : report_pass()
        );
    };
}

function any() {
    return function () {
        return report_pass();
    };
}


function none(...args) {

// Refuses all values.

    return function () {
        return report_fail(...args);
    };
}

function literal(expected) {
    return function (subject) {
        return (
            (
                subject === expected ||
                (
                    Number.isNaN(expected) &&
                    Number.isNaN(subject)
                )
            )
            ? report_pass()
            : report_fail("not_equal_to_a", expected)
        );
    };
}

function euphemize(value) {

// If 'value' is a not a function, it is wrapped in a "literal" validator. It is
// like an inverse of JSCheck's "resolve" function.

    return (
        typeof value === "function"
        ? value
        : literal(value)
    );
}

function all_of(validators, exhaustive = false) {
    return function (subject) {
        let reports = [];
        validators.some(function (validator) {
            const report = validator(subject);
            reports.push(report);
            const stop_now = (
                exhaustive === false &&
                report.violations.length > 0
            );
            return stop_now;
        });
        return {
            violations: reports.map((report) => report.violations).flat(),
            reports
        };
    };
}

function property(key, validator) {

// The 'property' validator applies the 'validator' to the 'key' property of the
// subject. The subject need not be an object, but an exception will be thrown
// if it is null or undefined.

    return function (subject) {
        const report = euphemize(validator)(subject[key]);
        return {

// Prepend the key to the path.

            violations: report.violations.map(function (violation) {
                return Object.assign({}, violation, {
                    path: (
                        violation.path === undefined
                        ? [key]
                        : [key].concat(violation.path)
                    )
                });
            }),
            reports: [report]
        };
    };
}

function wun_of(validators) {
    return function (subject) {
        const accumulated_violations = [];
        const pass = validators.map(euphemize).some(function (validator) {
            const report = validator(subject);
            accumulated_violations.push(...report.violations);
            return report.violations.length === 0;
        });
        return (
            pass
            ? report_pass()
            : {
                violations: [make_violation("not_wun_of")].concat(
                    accumulated_violations
                )
            }
        );
    };
}

function boolean() {
    return type("boolean");
}

function number(minimum, maximum) {
    return all_of([
        type("number"),
        function finite_validator(subject) {
            return (
                !Number.isFinite(subject)
                ? report_fail("not_finite")
                : report_pass()
            );
        },
        function bounds_validator(subject) {
            return (
                (
                    (minimum !== undefined && subject < minimum) ||
                    (maximum !== undefined && subject > maximum)
                )
                ? report_fail("out_of_bounds")
                : report_pass()
            );
        }
    ]);
}

function integer(minimum, maximum) {
    return all_of([
        function integer_validator(subject) {
            return (
                !Number.isSafeInteger(subject)
                ? report_fail("not_type_a", "integer")
                : report_pass()
            );
        },
        number(minimum, maximum)
    ]);
}

function string(argument) {
    return all_of([
        type("string"),
        (
            argument === undefined
            ? any()
            : (
                typeof argument.test === "function"
                ? function pattern_validator(subject) {
                    return (
                        argument.test(subject)
                        ? report_pass()
                        : report_fail("wrong_pattern")
                    );
                }
                : property("length", argument)
            )
        )
    ]);
}

function fn(length_validator = any()) {
    return all_of([
        type("function"),
        property("length", length_validator)
    ]);
}

function array(
    validator_array,
    length_validator,
    rest_validator
) {
    if (!Array.isArray(validator_array)) {

// The case of a homogenous array is equivalent to that of a heterogeneous array
// with only a "rest" validator.

        return array(
            [],
            coalesce(length_validator, any()),
            coalesce(validator_array, any())
        );
    }
    if (length_validator === undefined) {
        length_validator = validator_array.length;
    }
    function find_validator(element_nr) {

// Returns the validator for an element at the specified position in the subject
// array.

        return (
            element_nr < validator_array.length
            ? validator_array[element_nr]
            : (
                rest_validator === undefined
                ? validator_array[element_nr % validator_array.length]
                : rest_validator
            )
        );
    }
    return all_of([
        function array_validator(subject) {
            return (
                !Array.isArray(subject)
                ? report_fail("not_type_a", "array")
                : report_pass()
            );
        },
        property("length", length_validator),
        function elements_validator(subject) {
            return all_of(
                subject.map(function (ignore, element_nr) {
                    const validator = euphemize(find_validator(element_nr));
                    return property(element_nr, validator);
                }),
                true
            )(subject);
        }
    ]);
}

function object(...args) {
    if (args.length === 0) {

// If 'object' is called with no arguments, the subject's properties are
// ignored.

        return object(any(), any());
    }
    function heterogeneous_validator(subject) {
        const required_properties = coalesce(args[0], {});
        const optional_properties = coalesce(args[1], {});
        const allow_strays = coalesce(args[2], false);
        function property_values(validators_object) {
            return all_of(
                Object.keys(validators_object).map(function (key) {
                    return property(
                        key,
                        (
                            Object.keys(subject).includes(key)
                            ? euphemize(validators_object[key])
                            : any()
                        )
                    );
                }),
                true
            );
        }
        return all_of([
            all_of(
                Object.keys(
                    required_properties
                ).filter(function is_missing(key) {
                    return !Object.keys(subject).includes(key);
                }).map(function (key) {
                    return none("missing_property_a", key);
                }),
                true
            ),
            property_values(required_properties),
            property_values(optional_properties),
            all_of(
                Object.keys(subject).filter(function is_stray(key) {
                    return (
                        !allow_strays &&
                        !Object.keys(required_properties).includes(key) &&
                        !Object.keys(optional_properties).includes(key)
                    );
                }).map(function (key) {
                    return none("unexpected_property_a", key);
                }),
                true
            )
        ], true)(subject);
    }
    function homogenous_validator(subject) {
        const key_validator = coalesce(args[0], any());
        const value_validator = coalesce(args[1], any());
        const property_validators = Object.keys(
            subject
        ).map(function make_property_validator(key) {

// Returns a validator which validates both the key and the value of a property.

            return function property_validator(subject) {
                return all_of([
                    function (ignore) {
                        return euphemize(key_validator)(key);
                    },
                    property(key, value_validator)
                ], true)(subject);
            };
        });
        return all_of(property_validators, true)(subject);
    }
    return all_of([
        function object_validator(subject) {
            return (
                is_object(subject)
                ? report_pass()
                : report_fail("not_type_a", "object")
            );
        },
        (
            (
                is_object(args[0]) ||
                is_object(args[1])
            )
            ? heterogeneous_validator
            : homogenous_validator
        )
    ]);
}

export default Object.freeze({

// Each of JSCheck's specifiers are complemented by validator factories, with
// the exception of 'character' and 'falsy' (which are not very useful) and
// 'sequence' (which is stateful).

    any,

    boolean,
    number,
    integer,
    string,
    function: fn,

    literal,
    wun_of,
    all_of,

    array,
    object
});
