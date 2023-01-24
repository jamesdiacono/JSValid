// jsvalid.js
// James Diacono
// 2023-01-24

// Public Domain

const violation_messages = {
    missing_property_a: "Missing property '{a}'.",
    not_equal_to_a: "Not equal to '{a}'.",
    not_finite: "Not a finite number.",
    not_type_a: "Not of type {a}.",
    not_wun_of: "Not a valid option.",
    out_of_bounds: "Out of bounds.",
    unexpected: "Unexpected.",
    unexpected_classification_a: "Unexpected classification '{a}'.",
    unexpected_property_a: "Unexpected property '{a}'.",
    wrong_pattern: "Wrong pattern."
};
const rx_variable = /\{([^{}]*)\}/g;

function interpolate(template, container) {
    return template.replace(rx_variable, function (original, filling) {
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
    let violation = {
        message: interpolate(
            violation_messages[code],
            {a: exhibits[0]}
        ),
        code
    };
    if (exhibits.length > 0) {
        violation.a = exhibits[0];
    }
    return violation;
}

function is_object(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function owns(object, key) {

// This is several orders of magnitude faster than calling
// Object.keys(object).includes(key) when the number of keys is large.

    return (
        Object.prototype.hasOwnProperty.call(object, key)
        && Object.prototype.propertyIsEnumerable.call(object, key)
    );
}

// The validator factories. ////////////////////////////////////////////////////

function type(expected_type) {
    return function type_validator(subject) {
        const subject_type = typeof subject;
        return (
            subject_type !== expected_type
            ? [make_violation("not_type_a", expected_type)]
            : []
        );
    };
}

function any() {
    return function any_validator() {
        return [];
    };
}

function literal(expected) {
    return function literal_validator(subject) {
        return (
            (
                subject === expected || (
                    Number.isNaN(expected) && Number.isNaN(subject)
                )
            )
            ? []
            : [make_violation("not_equal_to_a", expected)]
        );
    };
}

function euphemize(value) {

// If 'value' is a not a function, it is wrapped in a "literal" validator.

    return (
        typeof value === "function"
        ? value
        : literal(value)
    );
}

function not(validator) {
    return function not_validator(subject) {
        return (
            euphemize(validator)(subject).length > 0
            ? []
            : [make_violation("unexpected")]
        );
    };
}

function all_of(validators, exhaustive = false) {
    return function all_of_validator(subject) {
        let all_violations = [];
        validators.some(function (validator) {
            const violations = validator(subject);
            all_violations = all_violations.concat(violations);
            const stop_now = (exhaustive === false && violations.length > 0);
            return stop_now;
        });
        return all_violations;
    };
}

function property(key, validator) {

// The 'property' validator applies the 'validator' to the 'key' property of the
// subject. The subject need not be an object, but an exception will be thrown
// if it is null or undefined.

    function prepend_key_to_path(violation) {
        return Object.assign({}, violation, {
            path: (
                violation.path === undefined
                ? [key]
                : [key].concat(violation.path)
            )
        });
    }

    return function property_validator(subject) {
        return euphemize(validator)(subject[key]).map(prepend_key_to_path);
    };
}

function wun_of(validators, classifier) {
    if (classifier !== undefined) {
        return function classified_validator(subject) {
            let key;
            try {
                key = classifier(subject);
            } catch (ignore) {

// The classifier might have made reckless assumptions about the structure of
// the subject, which is perfectly fine.

            }
            if (
                (typeof key === "string" || Number.isFinite(key))
                && owns(validators, String(key))
            ) {
                return euphemize(validators[key])(subject);
            }
            return [make_violation("unexpected_classification_a", key)];
        };
    }
    return function wun_of_validator(subject) {

// No classifier function was provided. We take a brute force approach, applying
// each validator until wun fits.

        let all_violations = [];
        return (
            validators.map(euphemize).some(function (validator) {
                const violations = validator(subject);
                all_violations = all_violations.concat(violations);
                return violations.length === 0;
            })
            ? []
            : [make_violation("not_wun_of"), ...all_violations]
        );
    };
}

function boolean() {
    return type("boolean");
}

function number(
    minimum,
    maximum,
    exclude_minimum = false,
    exclude_maximum = false
) {
    return all_of([
        type("number"),
        function number_validator(subject) {
            if (!Number.isFinite(subject)) {
                return [make_violation("not_finite")];
            }
            return (
                (
                    (
                        minimum !== undefined && (
                            exclude_minimum
                            ? subject <= minimum
                            : subject < minimum
                        )
                    ) || (
                        maximum !== undefined && (
                            exclude_maximum
                            ? subject >= maximum
                            : subject > maximum
                        )
                    )
                )
                ? [make_violation("out_of_bounds")]
                : []
            );
        }
    ]);
}

function integer(minimum, maximum) {
    return all_of([
        function integer_validator(subject) {
            return (
                !Number.isSafeInteger(subject)
                ? [make_violation("not_type_a", "integer")]
                : []
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
                        ? []
                        : [make_violation("wrong_pattern")]
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

function array(validator_array, length_validator, rest_validator) {
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

    function validator_at(element_nr) {

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
                ? [make_violation("not_type_a", "array")]
                : []
            );
        },
        property("length", length_validator),
        function elements_validator(subject) {
            return all_of(
                subject.map(function (ignore, element_nr) {
                    const validator = euphemize(validator_at(element_nr));
                    return property(element_nr, validator);
                }),
                true
            )(subject);
        }
    ]);
}

function object(zeroth, wunth, allow_strays = false) {

    function heterogeneous() {
        const required = coalesce(zeroth, {});
        const optional = coalesce(wunth, {});

        function is_stray(key) {
            return !owns(required, key) && !owns(optional, key);
        }

        return function heterogeneous_validator(subject) {
            let violations = [];

// Required properties must exist directly on the subject, not just in its
// prototype chain. This ensures that JSON representations of valid subjects
// include all required properties.

            Object.keys(required).forEach(function (key) {
                if (owns(subject, key)) {
                    violations = violations.concat(
                        property(key, euphemize(required[key]))(subject)
                    );
                } else {
                    violations.push(make_violation("missing_property_a", key));
                }
            });

// Optional properties are trickier. When an optional property is missing from
// the subject, there remains the possibility that it is buried somewhere in
// the prototype chain. If the value of such a property is invalid, it could
// cause problems when dredged up by unsuspecting code.

// To prevent this hazard, we simply access the optional property by name and
// validate the resulting value. A side effect of this approach is that a
// missing property is indistinguishable from a property with a value of
// undefined. I am ambivalent about this.

            Object.keys(optional).forEach(function (key) {
                if (subject[key] !== undefined) {
                    violations = violations.concat(
                        property(key, euphemize(optional[key]))(subject)
                    );
                }
            });
            if (!allow_strays) {
                violations = violations.concat(
                    Object.keys(subject).filter(is_stray).map(function (key) {
                        return make_violation("unexpected_property_a", key);
                    })
                );
            }
            return violations;
        };
    }

    function homogenous() {
        const key_validator = coalesce(zeroth, any());
        const value_validator = coalesce(wunth, any());
        return function homogenous_validator(subject) {
            return all_of(
                Object.keys(subject).map(function (key) {

// Returns a validator that validates both the key and the value of a single
// property.

                    return all_of([
                        function (ignore) {
                            return euphemize(key_validator)(key);
                        },
                        property(key, value_validator)
                    ], true);
                }),
                true
            )(subject);
        };
    }
    return all_of([
        function object_validator(subject) {
            return (
                is_object(subject)
                ? []
                : [make_violation("not_type_a", "object")]
            );
        },
        (
            (is_object(zeroth) || is_object(wunth))
            ? heterogeneous()
            : homogenous()
        )
    ]);
}

export default Object.freeze({

// Each of JSCheck's specifiers have a corresponding validator, with the
// exception of 'character' and 'falsy', which are not very useful, and
// 'sequence', which is stateful.

    boolean,
    number,
    integer,
    string,
    function: fn,
    array,
    object,

    wun_of,
    all_of,
    not,
    literal,
    any
});
