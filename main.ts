let keuze = 0
input.onGesture(Gesture.Shake, function () {
    keuze = randint(1, 3)
    for (let index = 0; index < 2; index++) {
        // Rock
        basic.showLeds(`
            . . # . .
            . # # # .
            # # # # #
            . # # # .
            . . # . .
            `)
        // Paper
        basic.showLeds(`
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            `)
        // Scissors
        basic.showLeds(`
            # . . . #
            . # . # .
            . . # . .
            # # . # #
            # # . # #
            `)
        basic.clearScreen()
    }
    if (keuze == 1) {
        // Rock
        basic.showLeds(`
            . . # . .
            . # # # .
            # # # # #
            . # # # .
            . . # . .
            `)
    } else if (keuze == 2) {
        // Paper
        basic.showLeds(`
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            `)
    } else {
        // Scissors
        basic.showLeds(`
            # . . . #
            . # . # .
            . . # . .
            # # . # #
            # # . # #
            `)
    }
})
basic.forever(function () {
	
})
basic.forever(function () {
	
})
