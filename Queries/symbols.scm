((field (label) @name) @subtree (#set! role property))
((let_clause left: (identifier) @name) @subtree (#set! role variable))

(((identifier) @name) @subtree (#has-parent? @name "for_clause") (#not-nth? @name -1) (#set! role variable))
